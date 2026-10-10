import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scanExecutionWorkspacePorts } from './execution-workspace-port-scanner'

const mocks = vi.hoisted(() => ({
  local: vi.fn(),
  ports: vi.fn(),
  getConnection: vi.fn(),
  forwards: vi.fn()
}))
vi.mock('./workspace-port-ownership', () => ({
  filterWorkspacePortProbes: (probes: { connectionId?: string }[]) =>
    probes.filter((probe) => !probe.connectionId),
  scanWorkspacePortProbes: mocks.local
}))
vi.mock('../execution-observer/observer-client', () => ({
  executionObserverClient: { ports: mocks.ports }
}))
vi.mock('../ipc/ssh-ipc-context', () => ({
  connectionManager: { getConnection: mocks.getConnection },
  portForwardManager: { listForwards: mocks.forwards }
}))
const workspace = {
  id: 'worktree',
  repoId: 'remote',
  displayName: 'test',
  path: '/remote/project',
  runsHere: false,
  connectionId: 'personal'
}
const scan = {
  platform: 'linux',
  scannedAt: 1,
  ports: [
    {
      id: '3000',
      kind: 'external',
      bindHost: '127.0.0.1',
      connectHost: '127.0.0.1',
      port: 3000,
      pid: 45,
      protocol: 'http'
    }
  ]
}

describe('execution-host port ownership', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.local.mockResolvedValue({ ...scan, ports: [] })
    mocks.ports.mockResolvedValue(scan)
    mocks.forwards.mockReturnValue([])
  })
  it('never scans localhost instead of a disconnected SSH-only repository', async () => {
    mocks.getConnection.mockReturnValue(undefined)
    const result = await scanExecutionWorkspacePorts([workspace], 'remote')
    expect(mocks.local).not.toHaveBeenCalled()
    expect(mocks.ports).not.toHaveBeenCalled()
    expect(result.ports).toEqual([])
    expect(result.unavailableReason).toContain('unverifiable')
  })
  it('discards a result from a previous connection generation', async () => {
    let generation = 1
    const connection = {
      getState: () => ({ status: 'connected', connectionGeneration: generation })
    }
    mocks.getConnection.mockReturnValue(connection)
    mocks.ports.mockImplementation(async () => {
      generation += 1
      return scan
    })
    const result = await scanExecutionWorkspacePorts([workspace], 'remote')
    expect(result.ports).toEqual([])
    expect(result.unavailableReason).toContain('unverifiable')
  })
  it('attaches SSH ownership and an existing forward, without changing the remote pid', async () => {
    const connection = { getState: () => ({ status: 'connected', connectionGeneration: 1 }) }
    mocks.getConnection.mockReturnValue(connection)
    mocks.forwards.mockReturnValue([{ remoteHost: 'localhost', remotePort: 3000, localPort: 4000 }])
    const result = await scanExecutionWorkspacePorts([workspace], 'remote')
    expect(result.ports[0]).toMatchObject({
      id: 'personal:3000',
      connectionId: 'personal',
      forwardedPort: 4000,
      pid: 45
    })
    expect(mocks.ports).toHaveBeenCalledWith(
      [
        {
          id: 'worktree',
          repoId: 'remote',
          displayName: 'test',
          path: '/remote/project',
          runsHere: true
        }
      ],
      connection
    )
  })
})
