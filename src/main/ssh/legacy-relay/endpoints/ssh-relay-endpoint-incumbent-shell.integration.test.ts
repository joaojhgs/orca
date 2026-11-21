/** Run generated probes through real /bin/sh, sockets and processes because host cleanup depends on their evidence. */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  isReapableRelayHusk,
  parseRelayEndpointIncumbentProbe,
  relayEndpointIncumbentProbeCommand,
  type RelayEndpointIncumbent
} from './ssh-relay-endpoint-incumbent'
import { RELAY_DAEMON_SERVICE_ENTRY_FILENAMES } from './relay-install-artifacts'

const posixOnly = process.platform === 'win32' ? describe.skip : describe

// The IPC channel confirms readiness and closes when the test kills the fake relay.
const IDLE_SERVICE_SOURCE = `
process.on('disconnect', () => process.exit(0))
setTimeout(() => process.exit(0), 60000)
process.send('ready')
`

const FAKE_RELAY_SOURCE = `
const net = require('net')
const path = require('path')
const sock = process.argv[process.argv.indexOf('--sock-path') + 1]
const children = []
const ready = []
function spawnChild(args) {
  const child = require('child_process').spawn(process.execPath, args, {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  })
  children.push(child)
  ready.push(new Promise((resolve, reject) => {
    child.once('message', resolve)
    child.once('error', reject)
    child.once('exit', () => reject(new Error('fake relay child exited before readiness')))
  }))
}
if (process.argv.includes('--with-child')) {
  spawnChild(['-e', ${JSON.stringify(IDLE_SERVICE_SOURCE)}])
}
// The census recognizes exact child argv shapes, so give service children only their script paths.
for (const name of process.argv.filter((arg) => arg.startsWith('--service-child='))) {
  spawnChild([path.join(__dirname, name.slice('--service-child='.length))])
}
const server = net.createServer(() => {})
process.once('SIGTERM', () => {
  server.close()
  for (const child of children) {
    if (child.connected) child.disconnect()
  }
})
Promise.all(ready).then(() => {
  server.listen(sock, () => process.stdout.write('READY\\n'))
}, () => process.exit(1))
`

function sh(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('/bin/sh', ['-c', script], { timeout: 20_000 }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stdout)
    })
  })
}

let workDir: string
let hasLsof = false
const running: ChildProcess[] = []
let endpointSequence = 0

function socketPath(name: string): string {
  return join(workDir, `${++endpointSequence}-${name}.sock`)
}

function startFakeRelay(
  sockPath: string,
  options: { withChild?: boolean; serviceChildren?: readonly string[] } = {}
): Promise<ChildProcess> {
  const args = [join(workDir, 'relay.js'), '--sock-path', sockPath]
  if (options.withChild) {
    args.push('--with-child')
  }
  for (const name of options.serviceChildren ?? []) {
    args.push(`--service-child=${name}`)
  }
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'ignore'] })
  running.push(child)
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('READY')) {
        resolve(child)
      }
    })
    child.once('error', reject)
    child.once('exit', (code, signal) =>
      reject(new Error(`Fake relay exited before listening (${code ?? signal})`))
    )
  })
}

async function probe(sockPath: string): Promise<RelayEndpointIncumbent> {
  const output = await sh(relayEndpointIncumbentProbeCommand(process.execPath, sockPath))
  return parseRelayEndpointIncumbentProbe(sockPath, output)
}

function expectRelayCensus(
  incumbent: RelayEndpointIncumbent,
  relay: ChildProcess,
  counts: { childCount: number; unrecognizedChildCount: number }
): void {
  expect(incumbent).toMatchObject({ verdict: 'live', holdersEnumerable: true })
  const holders = incumbent.holders.filter(({ pid }) => pid === relay.pid)
  expect(holders, JSON.stringify(incumbent.holders)).toEqual([
    { pid: relay.pid, matchesRelayArgv: true, ...counts }
  ])

  const noUserWork = counts.unrecognizedChildCount === 0
  expect(isReapableRelayHusk({ ...incumbent, holders })).toBe(noUserWork)
  // lsof may also report an unrelated PID. The full census must fail closed in that case.
  expect(isReapableRelayHusk(incumbent)).toBe(noUserWork && incumbent.holders.length === 1)
}

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'orca-relay-incumbent-'))
  writeFileSync(join(workDir, 'relay.js'), FAKE_RELAY_SOURCE)
  for (const filename of RELAY_DAEMON_SERVICE_ENTRY_FILENAMES) {
    writeFileSync(join(workDir, filename), IDLE_SERVICE_SOURCE)
  }
  writeFileSync(join(workDir, 'looks-like-relay-watcher.js'), IDLE_SERVICE_SOURCE)
  hasLsof = await sh('command -v lsof >/dev/null 2>&1 && echo yes || echo no').then(
    (out) => out.trim() === 'yes'
  )
})

afterEach(async () => {
  await Promise.all(
    running.splice(0).map(async (child) => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
        return
      }
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      await exited
    })
  )
})

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

posixOnly('relay endpoint probe against a real socket', () => {
  it('reports live, and identifies the holding process, for a listening relay', async () => {
    const sockPath = socketPath('live')
    const relay = await startFakeRelay(sockPath)
    const incumbent = await probe(sockPath)

    expect(incumbent.verdict).toBe('live')
    expect(incumbent.evidence).toBe('accepted-connection')
    expect(incumbent.socketPresent).toBe(true)
    if (!hasLsof) {
      return
    }
    expectRelayCensus(incumbent, relay, { childCount: 0, unrecognizedChildCount: 0 })
  })

  it("counts the daemon's own service children but does not hold them against it", async () => {
    const sockPath = socketPath('services')
    const relay = await startFakeRelay(sockPath, {
      serviceChildren: RELAY_DAEMON_SERVICE_ENTRY_FILENAMES
    })
    const incumbent = await probe(sockPath)

    expectRelayCensus(incumbent, relay, {
      childCount: RELAY_DAEMON_SERVICE_ENTRY_FILENAMES.length,
      unrecognizedChildCount: 0
    })
  })

  it('still retains a relay holding work alongside its service children', async () => {
    const sockPath = socketPath('services-and-work')
    const relay = await startFakeRelay(sockPath, {
      withChild: true,
      serviceChildren: RELAY_DAEMON_SERVICE_ENTRY_FILENAMES
    })
    const incumbent = await probe(sockPath)
    expectRelayCensus(incumbent, relay, {
      childCount: RELAY_DAEMON_SERVICE_ENTRY_FILENAMES.length + 1,
      unrecognizedChildCount: 1
    })
  })

  it('does not excuse a child that merely mentions a service entry name', async () => {
    const sockPath = socketPath('lookalike')
    const relay = await startFakeRelay(sockPath, {
      serviceChildren: ['looks-like-relay-watcher.js']
    })
    const incumbent = await probe(sockPath)
    expectRelayCensus(incumbent, relay, { childCount: 1, unrecognizedChildCount: 1 })
  })

  it('refuses to call a relay with a live child an empty husk', async () => {
    const sockPath = socketPath('busy')
    const relay = await startFakeRelay(sockPath, { withChild: true })
    const incumbent = await probe(sockPath)

    expect(incumbent.verdict).toBe('live')
    if (!hasLsof) {
      return
    }
    expectRelayCensus(incumbent, relay, { childCount: 1, unrecognizedChildCount: 1 })
  })

  it('reports exited for a socket inode a SIGKILLed relay left behind', async () => {
    const sockPath = socketPath('stale')
    const relay = await startFakeRelay(sockPath)
    const exited = once(relay, 'exit')
    relay.kill('SIGKILL')
    await exited

    const incumbent = await probe(sockPath)
    expect(incumbent.socketPresent).toBe(true)
    expect(incumbent.verdict).toBe(hasLsof ? 'exited' : 'unverifiable')
  })

  it('answers unverifiable when lsof cannot stat a never-bound path', async () => {
    const incumbent = await probe(socketPath('never-existed'))
    expect(incumbent.socketPresent).toBe(false)
    expect(incumbent.verdict).toBe('unverifiable')
    expect(incumbent.holdersEnumerable).toBe(false)
    expect(incumbent.holders).toEqual([])
    expect(isReapableRelayHusk(incumbent)).toBe(false)
  })
})
