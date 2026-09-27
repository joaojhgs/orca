import { Buffer } from 'node:buffer'
import type { SshConnection } from '../ssh/ssh-connection'
import { execCommand } from '../ssh/ssh-relay-deploy-helpers'
import type { RemoteResourceSnapshot } from './remote-resource-provider-registry'

const SCRIPT = String.raw`
const fs=require('fs'),os=require('os'),cp=require('child_process');
function ticks(){try{const p=fs.readFileSync('/proc/stat','utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number),idle=(p[3]||0)+(p[4]||0);return {idle,total:p.reduce((a,b)=>a+b,0)}}catch{return null}}
const before=ticks();if(before)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);const after=ticks();const cpuUsagePercent=before&&after&&after.total>before.total?Math.max(0,Math.min(100,(1-(after.idle-before.idle)/(after.total-before.total))*100)):undefined;
const total=os.totalmem(),free=os.freemem();let available=free;
try{const m=/^MemAvailable:\s*(\d+)\s+kB$/m.exec(fs.readFileSync('/proc/meminfo','utf8'));if(m)available=Number(m[1])*1024}catch{}
let disk={};try{const devices=new Map();for(const line of cp.execFileSync('df',['-Pk'],{encoding:'utf8'}).split(/\r?\n/).slice(1)){const f=line.trim().split(/\s+/);if(f.length>=6&&f[0].startsWith('/dev/'))devices.set(f[0],[Number(f[1])*1024,Number(f[2])*1024,Number(f[3])*1024])}const v=Array.from(devices.values()),diskTotal=v.reduce((s,x)=>s+x[0],0),diskUsed=v.reduce((s,x)=>s+x[1],0),diskAvailable=v.reduce((s,x)=>s+x[2],0);if(diskTotal>0)disk={diskTotal,diskUsed,diskAvailable,diskUsagePercent:diskUsed/diskTotal*100}}catch{}
const host={totalMemory:total,freeMemory:free,availableMemory:available,availableMemorySource:available===free?'free-memory':'proc-meminfo',usedMemory:Math.max(0,total-available),memoryUsagePercent:total?Math.max(0,total-available)/total*100:0,cpuCoreCount:Math.max(1,os.cpus().length),loadAverage1m:Math.max(0,os.loadavg()[0]||0),...(cpuUsagePercent===undefined?{}:{cpuUsagePercent}),...disk};
const groups=new Map();
if(process.platform!=='win32')try{for(const line of cp.execFileSync('ps',['-eo','pid=,pcpu=,rss='],{encoding:'utf8'}).split(/\r?\n/)){const [pid,cpu,rss]=line.trim().split(/\s+/).map(Number);if(!Number.isSafeInteger(pid))continue;let env='';try{env=fs.readFileSync('/proc/'+pid+'/environ','utf8')}catch{continue}const fields=Object.fromEntries(env.split('\0').filter(Boolean).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),v.slice(i+1)]}));if(!fields.ORCA_WORKTREE_ID||!fields.ORCA_PANE_KEY)continue;const key=fields.ORCA_WORKTREE_ID+'\0'+fields.ORCA_PANE_KEY;const row=groups.get(key)||{worktreeId:fields.ORCA_WORKTREE_ID,paneKey:fields.ORCA_PANE_KEY,cpu:0,memory:0,pid};row.cpu+=Number.isFinite(cpu)?Math.max(0,cpu):0;row.memory+=Number.isFinite(rss)?Math.max(0,rss)*1024:0;groups.set(key,row)}}catch{}
const byWorktree=new Map();for(const row of groups.values()){const sessions=byWorktree.get(row.worktreeId)||[];sessions.push({sessionId:'resource:'+row.paneKey,paneKey:row.paneKey,pid:row.pid,cpu:row.cpu,memory:row.memory});byWorktree.set(row.worktreeId,sessions)}
process.stdout.write(JSON.stringify({host,worktrees:Array.from(byWorktree,([worktreeId,sessions])=>({worktreeId,sessions}))}));`

export async function collectLegacyRemoteResourceSnapshot(
  connection: SshConnection,
  nodePath: string
): Promise<RemoteResourceSnapshot> {
  const encoded = Buffer.from(SCRIPT).toString('base64')
  const stdout = await execCommand(
    connection,
    `${nodePath} -e "eval(Buffer.from('${encoded}','base64').toString())"`,
    { timeoutMs: 5_000 }
  )
  return JSON.parse(stdout) as RemoteResourceSnapshot
}
