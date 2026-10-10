import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshConnection } from '../ssh/ssh-connection'
import { getRemoteHostPlatform } from '../ssh/ssh-remote-platform'
import { decodeRemotePowerShellScript } from '../ssh/ssh-remote-powershell'

const mocks = vi.hoisted(() => ({
  sessions: new Map(),
  exec: vi.fn(),
  readFile: vi.fn(),
  runProcess: vi.fn()
}))
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }))
vi.mock('../ipc/ssh-active-relay-sessions', () => ({ activeSessions: mocks.sessions }))
vi.mock('../ssh/ssh-relay-exec-command', () => ({ execCommand: mocks.exec }))
vi.mock('@orca/process-host', () => ({ runProcess: mocks.runProcess }))

const { ExecutionObserverClient } = await import('./observer-client')

function connection(id: string) {
  const state = { status: 'connected', connectionGeneration: 1 }
  const stub = { getState: () => state, getTarget: () => ({ id }) }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Observer only reads these two methods from the fixture.
  return { connection: stub as SshConnection, state }
}

function session(
  id: string,
  nodePath: string,
  platform: 'linux-x64' | 'darwin-arm64' | 'win32-x64' = 'linux-x64'
) {
  const stub = {
    getState: vi.fn(() => 'ready'),
    getRemoteNodePath: () => nodePath,
    getHostPlatform: () => getRemoteHostPlatform(platform)
  }
  mocks.sessions.set(id, stub)
  return stub
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.sessions.clear()
  mocks.readFile.mockResolvedValue('/* observer fixture */')
  mocks.exec.mockResolvedValue('ORCA_OBSERVER_RESULT:[]\n')
})

describe('execution-host observer launch', () => {
  it('uses each host’s resolved Node, independent of PATH, without changing the discovery payload', async () => {
    const client = new ExecutionObserverClient('/fixture/observer.cjs')
    for (const [id, node] of [
      ['work', '/home/developer/.asdf/shims/node'],
      ['personal', '/usr/bin/node'],
      ['university', '/usr/local/bin/node'],
      ['mac', "/Users/O'Brien/Node Runtime/bin/node"]
    ]) {
      const fixture = connection(id!)
      session(id!, node!, id === 'mac' ? 'darwin-arm64' : 'linux-x64')
      await expect(client.discover(fixture.connection)).resolves.toEqual([])
      const call = mocks.exec.mock.lastCall!
      expect(call[0]).toBe(fixture.connection)
      expect(call[1]).not.toBe('node -')
      expect(call[2]).toMatchObject({ timeoutMs: 70000 })
      const encoded = call[2].input.match(/ORCA_OBSERVER_REQUEST = "([^"]+)"/)![1]
      expect(JSON.parse(Buffer.from(encoded, 'base64').toString())).toEqual({
        operation: 'discover'
      })
    }
    expect(mocks.exec.mock.calls[3]![1]).toBe("'/Users/O'\\''Brien/Node Runtime/bin/node' -")
    expect(mocks.readFile).toHaveBeenCalledTimes(1)
    expect(mocks.runProcess).not.toHaveBeenCalled()
  })

  it('launches Windows Node with literal path quoting and no POSIX shell wrapper', async () => {
    const fixture = connection('windows')
    session('windows', "C:/Users/O'Brien/Node Runtime/node.exe", 'win32-x64')
    await new ExecutionObserverClient('/fixture').discover(fixture.connection)
    const call = mocks.exec.mock.lastCall!
    expect(decodeRemotePowerShellScript(call[1])).toBe(
      "& 'C:/Users/O''Brien/Node Runtime/node.exe' -; exit $LASTEXITCODE"
    )
    expect(call[2].wrapCommand).toBe(false)
  })

  it('does not run locally when the host is disconnected or its relay is not ready', async () => {
    const fixture = connection('work')
    const relay = session('work', '/resolved/node')
    const client = new ExecutionObserverClient('/fixture')
    fixture.state.status = 'disconnected'
    await expect(client.discover(fixture.connection)).rejects.toThrow('unverifiable')
    fixture.state.status = 'connected'
    relay.getState.mockReturnValue('deploying')
    await expect(client.discover(fixture.connection)).rejects.toThrow('unverifiable')
    mocks.sessions.clear()
    await expect(client.discover(fixture.connection)).rejects.toThrow('unverifiable')
    expect(mocks.exec).not.toHaveBeenCalled()
    expect(mocks.runProcess).not.toHaveBeenCalled()
  })

  it('rejects a result from a previous connection generation even if reconnected', async () => {
    const fixture = connection('work')
    session('work', '/resolved/node')
    mocks.exec.mockImplementation(async () => {
      fixture.state.connectionGeneration++
      return 'ORCA_OBSERVER_RESULT:[]\n'
    })
    await expect(
      new ExecutionObserverClient('/fixture').discover(fixture.connection)
    ).rejects.toThrow('unverifiable')
  })

  it('rejects a result when the relay owner is replaced mid-request', async () => {
    const fixture = connection('work')
    session('work', '/resolved/node')
    mocks.exec.mockImplementation(async () => {
      session('work', '/replacement/node')
      return 'ORCA_OBSERVER_RESULT:[]\n'
    })
    await expect(
      new ExecutionObserverClient('/fixture').discover(fixture.connection)
    ).rejects.toThrow('unverifiable')
  })

  it('keeps local observation unchanged', async () => {
    mocks.runProcess.mockResolvedValue({ code: 0, stdout: 'ORCA_OBSERVER_RESULT:[]\n' })
    await expect(new ExecutionObserverClient('/fixture').discover()).resolves.toEqual([])
    expect(mocks.runProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        program: process.execPath,
        args: ['-'],
        env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1', ORCA_BACKGROUND_LAUNCH: '1' })
      })
    )
    expect(mocks.exec).not.toHaveBeenCalled()
  })
})
