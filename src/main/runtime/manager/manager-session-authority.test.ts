import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../orca-runtime'
import { requireManagerSession } from './manager-session-authority'
import { requireManagerPrincipal } from './manager-runtime-authority'
vi.mock('./manager-runtime-authority', () => ({ requireManagerPrincipal: vi.fn() }))
const principal = {
  id: 'principal',
  label: 'Coding',
  createdAt: 1,
  expiresAt: 1000,
  grant: {
    scope: { executionHostIds: ['ssh:worker'], projectIds: ['repo:repo'], runIds: [] },
    actions: ['session:read' as const]
  }
}
function fixture() {
  const runtime = {
    getOrchestrationDb: () => ({ managerPrincipals: { authorize: vi.fn(() => principal) } }),
    getPaneKeyForTerminalHandle: () => 'pane',
    resolveTerminalPane: vi.fn(() => ({
      handle: 'manual',
      worktreeId: 'repo::/repo',
      executionHostId: 'ssh:worker',
      incarnationId: 'incarnation',
      connected: true,
      ptyId: 'pty'
    })),
    listRepos: () => [
      {
        id: 'repo',
        path: '/repo',
        displayName: 'Project',
        badgeColor: 'blue',
        addedAt: 1,
        connectionId: 'worker'
      }
    ],
    listProjectHostSetups: () => [],
    listFolderWorkspaces: () => []
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: requireManagerSession only calls the mocked runtime surface above.
  return { runtime: runtime as unknown as OrcaRuntimeService, resolve: runtime.resolveTerminalPane }
}
beforeEach(() => vi.mocked(requireManagerPrincipal).mockReturnValue(principal))
const params = { serviceToken: 'secret', terminal: 'manual', incarnationId: 'incarnation' }
describe('project session authority independent of dispatch ownership', () => {
  it('authorizes a manually started session in the granted host/project', () => {
    expect(requireManagerSession(fixture().runtime, params, 'session:read').scope.projectId).toBe(
      'repo:repo'
    )
  })
  it('refuses another host even with the same repo/terminal identity', () => {
    const f = fixture()
    f.resolve.mockReturnValue({ ...f.resolve(), executionHostId: 'ssh:other' })
    expect(() => requireManagerSession(f.runtime, params, 'session:read')).toThrow('outside')
  })
  it('refuses another project', () => {
    const f = fixture()
    f.resolve.mockReturnValue({ ...f.resolve(), worktreeId: 'other::/repo' })
    expect(() => requireManagerSession(f.runtime, params, 'session:read')).toThrow('outside')
  })
  it('refuses stale incarnation and disconnected contact without claiming exit', () => {
    const f = fixture()
    expect(() =>
      requireManagerSession(f.runtime, { ...params, incarnationId: 'old' }, 'session:read')
    ).toThrow('changed')
    f.resolve.mockReturnValue({ ...f.resolve(), connected: false })
    expect(() => requireManagerSession(f.runtime, params, 'session:read')).toThrow('changed')
  })
})
