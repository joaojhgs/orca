import { readFile } from 'node:fs/promises'
import os from 'node:os'
import { runProcess } from '../shared/child-process/run-process'
import type { HostMemory, SessionMemory } from '../shared/process-stats-types'
import { parseLinuxAvailableMemory } from '../main/memory/host-memory'

let previousCpuTicks: { idle: number; total: number } | null = null

type ProcessRow = { pid: number; ppid: number; cpu: number; memory: number }

function cpuTicks(): { idle: number; total: number } {
  let idle = 0
  let total = 0
  for (const cpu of os.cpus()) {
    if (!cpu?.times) {
      continue
    }
    idle += cpu.times.idle
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0)
  }
  return { idle, total }
}

function hostCpuUsagePercent(): number | undefined {
  const current = cpuTicks()
  if (current.total <= 0) {
    return undefined
  }
  const previous = previousCpuTicks
  previousCpuTicks = current
  if (!previous) {
    return undefined
  }
  const total = current.total - previous.total
  const idle = current.idle - previous.idle
  return total > 0 ? Math.max(0, Math.min(100, ((total - idle) / total) * 100)) : undefined
}

async function collectHost(): Promise<HostMemory> {
  const totalMemory = os.totalmem()
  const freeMemory = os.freemem()
  let availableMemory = freeMemory
  let availableMemorySource: HostMemory['availableMemorySource'] = 'free-memory'
  if (process.platform === 'linux') {
    try {
      const stdout = await readFile('/proc/meminfo', 'utf8')
      availableMemory = parseLinuxAvailableMemory(stdout) ?? freeMemory
      availableMemorySource = 'proc-meminfo'
    } catch {
      /* fall back to os.freemem */
    }
  }
  const usedMemory = Math.max(0, totalMemory - availableMemory)
  const cpuUsagePercent = hostCpuUsagePercent()
  let disk: Pick<HostMemory, 'diskTotal' | 'diskUsed' | 'diskAvailable' | 'diskUsagePercent'> = {}
  if (process.platform !== 'win32') {
    try {
      const { stdout, code } = await runProcess({ program: 'df', args: ['-Pk'], timeoutMs: 5_000 })
      if (code !== 0) {
        throw new Error('Disk resource snapshot unavailable')
      }
      const devices = new Map<string, number[]>()
      for (const line of stdout.split(/\r?\n/).slice(1)) {
        const fields = line.trim().split(/\s+/)
        if (fields.length >= 6 && fields[0].startsWith('/dev/')) {
          devices.set(fields[0], [
            Number(fields[1]) * 1024,
            Number(fields[2]) * 1024,
            Number(fields[3]) * 1024
          ])
        }
      }
      const values = Array.from(devices.values())
      const diskTotal = values.reduce((sum, item) => sum + item[0], 0)
      const diskUsed = values.reduce((sum, item) => sum + item[1], 0)
      const diskAvailable = values.reduce((sum, item) => sum + item[2], 0)
      if (diskTotal > 0) {
        disk = {
          diskTotal,
          diskUsed,
          diskAvailable,
          diskUsagePercent: (diskUsed / diskTotal) * 100
        }
      }
    } catch {
      /* unavailable */
    }
  }
  return {
    totalMemory,
    freeMemory,
    availableMemory,
    availableMemorySource,
    usedMemory,
    memoryUsagePercent: totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0,
    cpuCoreCount: Math.max(1, os.cpus().length),
    loadAverage1m: Math.max(0, os.loadavg()[0] ?? 0),
    ...(cpuUsagePercent === undefined ? {} : { cpuUsagePercent }),
    ...disk
  }
}

function parseProcesses(stdout: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 4) {
      continue
    }
    const [pid, ppid, cpu, rss] = fields.map(Number)
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(ppid)) {
      continue
    }
    rows.push({
      pid,
      ppid,
      cpu: Number.isFinite(cpu) ? Math.max(0, cpu) : 0,
      memory: Number.isFinite(rss) ? Math.max(0, rss) * 1024 : 0
    })
  }
  return rows
}

export async function collectRelayResourceSnapshot(
  ptys: readonly { id: string; pid: number; paneKey?: string; worktreeId?: string }[]
): Promise<{
  host: HostMemory
  worktrees: { worktreeId: string | null; sessions: SessionMemory[] }[]
}> {
  const host = await collectHost()
  if (process.platform === 'win32') {
    return { host, worktrees: [] }
  }
  const { stdout, code, outputTruncated } = await runProcess({
    program: 'ps',
    args: ['-eo', 'pid=,ppid=,pcpu=,rss='],
    timeoutMs: 5_000,
    maxOutputBytes: 10 * 1024 * 1024
  })
  if (code !== 0 || outputTruncated) {
    throw new Error('Process resource snapshot unavailable')
  }
  const rows = parseProcesses(stdout)
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  const children = new Map<number, number[]>()
  for (const row of rows) {
    children.set(row.ppid, [...(children.get(row.ppid) ?? []), row.pid])
  }
  const claimed = new Set<number>()
  const grouped = new Map<string | null, SessionMemory[]>()
  for (const pty of ptys) {
    let cpu = 0
    let memory = 0
    const queue = [pty.pid]
    while (queue.length) {
      const pid = queue.pop()!
      if (claimed.has(pid)) {
        continue
      }
      claimed.add(pid)
      const row = byPid.get(pid)
      if (row) {
        cpu += row.cpu
        memory += row.memory
      }
      queue.push(...(children.get(pid) ?? []))
    }
    const sessions = grouped.get(pty.worktreeId ?? null) ?? []
    sessions.push({ sessionId: pty.id, paneKey: pty.paneKey ?? null, pid: pty.pid, cpu, memory })
    grouped.set(pty.worktreeId ?? null, sessions)
  }
  return {
    host,
    worktrees: Array.from(grouped, ([worktreeId, sessions]) => ({ worktreeId, sessions }))
  }
}
