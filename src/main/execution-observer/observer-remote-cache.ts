import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import type { SshConnection } from '../ssh/ssh-connection'
import { execCommand } from '../ssh/ssh-relay-exec-command'

type CacheOwner = { generation: number; files: Map<string, Promise<string>> }
const owners = new WeakMap<SshConnection, CacheOwner>()

export function invalidateRemoteObserver(
  connection: SshConnection,
  digest: string,
  generation: number
): void {
  const owner = owners.get(connection)
  if (owner?.generation === generation) {
    owner.files.delete(digest)
  }
}

function cacheScript(digest: string): string {
  return `const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.join(require('node:os').homedir(), '.orca-remote', 'observers');
const file = path.join(root, '${digest}.cjs');
function verified() {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && stat.size <= 8388608 && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === '${digest}';
  } catch { return false; }
}
`
}

export function cachedObserverInput(file: string, digest: string, encoded: string): string {
  // Compile the verified bytes, not a second path read that could race a cache replacement.
  return `process.env.ORCA_OBSERVER_REQUEST = ${JSON.stringify(encoded)};
const fs = require('node:fs'), crypto = require('node:crypto'), Module = require('node:module');
const file = ${JSON.stringify(file)};
const stat = fs.lstatSync(file);
if (!stat.isFile() || stat.size > 8388608) throw Error('Invalid observer cache');
const bytes = fs.readFileSync(file);
if (crypto.createHash('sha256').update(bytes).digest('hex') !== '${digest}') throw Error('Observer cache changed');
const loaded = new Module(file, module);
loaded.filename = file;
loaded.paths = Module._nodeModulePaths(require('node:path').dirname(file));
loaded._compile(bytes.toString('utf8'), file);
`
}

export async function ensureRemoteObserver(
  connection: SshConnection,
  command: string,
  bundle: string,
  wrapCommand: boolean
): Promise<{ file: string; digest: string }> {
  const digest = createHash('sha256').update(bundle).digest('hex')
  const generation = connection.getConnectGeneration()
  let owner = owners.get(connection)
  if (!owner || owner.generation !== generation) {
    owner = { generation, files: new Map() }
    owners.set(connection, owner)
  }
  const files = owner.files
  let pending = files.get(digest)
  if (!pending) {
    const execute = (input: string) =>
      execCommand(connection, command, {
        input,
        wrapCommand,
        timeoutMs: 180000,
        maxOutputChars: 32768
      })
    pending = (async () => {
      const script = cacheScript(digest)
      const probe = await execute(
        `${script}\nconsole.log('ORCA_OBSERVER_CACHE:' + JSON.stringify(verified() ? file : null));`
      )
      const line = probe.split('\n').findLast((line) => line.startsWith('ORCA_OBSERVER_CACHE:'))
      if (!line) {
        throw new Error('Invalid observer cache response')
      }
      const existing: unknown = JSON.parse(line.slice('ORCA_OBSERVER_CACHE:'.length))
      if (typeof existing === 'string' && existing.length > 0) {
        return existing
      }
      if (existing !== null) {
        throw new Error('Invalid observer cache path')
      }
      const compressed = gzipSync(bundle).toString('base64')
      const installed = await execute(`${script}
fs.mkdirSync(root, {recursive: true, mode: 0o700});
if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) throw Error('Invalid observer cache directory');
const bytes = require('node:zlib').gunzipSync(Buffer.from('${compressed}', 'base64'), {maxOutputLength: 8388608});
if (crypto.createHash('sha256').update(bytes).digest('hex') !== '${digest}') throw Error('Invalid observer bundle');
const temporary = file + '.' + crypto.randomBytes(12).toString('hex') + '.tmp';
try {
  fs.writeFileSync(temporary, bytes, {flag: 'wx', mode: 0o600});
  fs.renameSync(temporary, file);
} finally { try { fs.unlinkSync(temporary); } catch {} }
console.log('ORCA_OBSERVER_CACHE:' + JSON.stringify(file));
`)
      const result = installed
        .split('\n')
        .findLast((line) => line.startsWith('ORCA_OBSERVER_CACHE:'))
      const file: unknown = result ? JSON.parse(result.slice('ORCA_OBSERVER_CACHE:'.length)) : null
      if (typeof file !== 'string' || !file) {
        throw new Error('Observer cache installation failed')
      }
      return file
    })()
    files.set(digest, pending)
    pending.catch(() => {
      if (files.get(digest) === pending) {
        files.delete(digest)
      }
    })
  }
  return { file: await pending, digest }
}
