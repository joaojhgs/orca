import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installBrowserGlobals,
  writeStoredRuntimeEnvironment
} from './web-preload-api-test-harness'

describe('hosted cleanup and process inventory', () => {
  const call = vi.fn()
  beforeEach(() => {
    vi.resetModules()
    call.mockReset()
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call(method: string, params: unknown): Promise<unknown> {
          return call(method, params)
        }
        close(): void {}
      }
    }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('./web-runtime-client')
  })
  async function api() {
    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage, 'control')
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()
    return { client: globals.window.api }
  }
  function reply(result: unknown) {
    return { id: 'test', ok: true, result, _meta: { runtimeId: 'control' } }
  }

  it('routes broad scans, cached results and pruning through the paired host', async () => {
    const scan = { scannedAt: 1, candidates: [], errors: [] }
    call.mockImplementation((_method, params) =>
      Promise.resolve(reply(params.operation === 'scan' ? scan : null))
    )
    const { client } = await api()
    await expect(
      client.workspaceCleanup.scan({ scanId: 'scan', includeAllWorkspaces: true })
    ).resolves.toEqual(scan)
    expect(call).toHaveBeenCalledWith('workspaceCleanup.control', {
      operation: 'scan',
      args: { scanId: 'scan', includeAllWorkspaces: true }
    })
    await expect(client.workspaceCleanup.getCachedScan()).resolves.toBeNull()
    await client.workspaceCleanup.recordRemovalSnapshotPrune?.({
      batchId: 'batch',
      worktreeId: 'repo::/same',
      executionHostId: 'ssh:personal'
    })
    expect(call).toHaveBeenLastCalledWith('workspaceCleanup.control', {
      operation: 'recordRemovalSnapshotPrune',
      args: { batchId: 'batch', worktreeId: 'repo::/same', executionHostId: 'ssh:personal' }
    })
  })
  it('rejects malformed scans rather than reporting zero safe workspaces', async () => {
    call.mockResolvedValue(reply(undefined))
    await expect((await api()).client.workspaceCleanup.scan({ scanId: 'scan' })).rejects.toThrow(
      'invalid workspace cleanup scan'
    )
  })
  it('preserves host scope and ownership evidence for diagnostics', async () => {
    const sessions = [
      {
        id: 'ssh:personal@@pty',
        cwd: '/project',
        title: 'Codex',
        worktreeId: 'repo::/project',
        agentOwnership: 'present',
        executionHostId: 'ssh:personal'
      }
    ]
    call.mockResolvedValue(reply({ sessions }))
    const { client } = await api()
    await expect(client.pty.listSessions({ connectionId: 'personal' })).resolves.toEqual(
      sessions.map((session) => ({ ...session, runtimeOwnerEnvironmentId: 'control' }))
    )
    expect(call).toHaveBeenCalledWith('diagnostics.sessions', {
      scope: { connectionId: 'personal' }
    })
  })
  it('does not mask transport failures as empty inventory or a zero memory sample', async () => {
    call.mockResolvedValue({
      id: 'test',
      ok: false,
      error: { code: 'unavailable', message: 'Host disconnected' },
      _meta: { runtimeId: 'control' }
    })
    const { client } = await api()
    await expect(client.pty.listSessions()).rejects.toThrow('Host disconnected')
    await expect(client.memory.getSnapshot()).rejects.toThrow('Host disconnected')
  })
  it('marks memory with its paired runtime owner', async () => {
    call.mockResolvedValue(reply({ worktrees: [], totalMemory: 500 }))
    await expect((await api()).client.memory.getSnapshot()).resolves.toMatchObject({
      runtimeOwnerEnvironmentId: 'control',
      totalMemory: 500
    })
  })
  it('resolves raw PTY ids to a fresh fenced handle before inspection and close', async () => {
    call.mockImplementation((method) =>
      Promise.resolve(
        reply(
          method === 'terminal.list'
            ? {
                terminals: [
                  {
                    ptyId: 'ssh:personal@@pty',
                    handle: 'term-current',
                    incarnationId: 'inc-current',
                    connected: true
                  }
                ]
              }
            : { process: { foregroundProcess: 'codex', hasChildProcesses: true } }
        )
      )
    )
    const { client } = await api()
    await expect(client.pty.inspectProcess('ssh:personal@@pty')).resolves.toMatchObject({
      foregroundProcess: 'codex',
      hasChildProcesses: true
    })
    await client.pty.kill('ssh:personal@@pty')
    expect(call).toHaveBeenCalledWith('terminal.close', {
      terminal: 'term-current',
      expectedIncarnationId: 'inc-current'
    })
  })
  it('refuses to close an unverified PTY', async () => {
    call.mockResolvedValue(reply({ terminals: [] }))
    await expect((await api()).client.pty.kill('ssh:missing@@pty')).rejects.toThrow(
      'terminal_liveness_unavailable'
    )
    expect(call.mock.calls.every(([method]) => method === 'terminal.list')).toBe(true)
  })

  it('refuses a close after the selected paired runtime changed', async () => {
    const { client } = await api()
    await expect(
      client.pty.kill('pty', { runtimeOwnerEnvironmentId: 'other-server' })
    ).rejects.toThrow('terminal_runtime_owner_changed')
    expect(call).not.toHaveBeenCalled()
  })
})
