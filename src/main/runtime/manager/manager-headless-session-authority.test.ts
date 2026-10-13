import { describe, expect, it, vi } from 'vitest'
import { createRuntime, TEST_WORKTREE_ID } from '../orca-runtime-test-fixtures.spec'
import { requireManagerSession } from './manager-session-authority'
import { requireManagerPrincipal } from './manager-runtime-authority'

vi.mock('./manager-runtime-authority', () => ({ requireManagerPrincipal: vi.fn() }))

const principal = {
  id: 'coding',
  label: 'Coding',
  createdAt: 1,
  expiresAt: 1000,
  grant: {
    scope: {
      executionHostIds: ['ssh:worker'],
      projectIds: [],
      runIds: [],
      allRegisteredProjects: true
    },
    actions: ['session:guide' as const]
  }
}

describe('headless manager session authority', () => {
  it('resolves a live relay PTY without a renderer pane and keeps incarnation fencing', async () => {
    const runtime = createRuntime()
    runtime.registerPty('ssh:worker@@relay-pty', TEST_WORKTREE_ID, 'worker', {
      tabId: 'recorded-tab',
      leafId: 'pane:1',
      incarnationId: 'meeting-claude'
    })
    const page = await runtime.listTerminals(`id:${TEST_WORKTREE_ID}`)
    const terminal = page.terminals[0]
    expect(terminal.orphaned).toBe(true)
    expect(runtime.resolveTerminalSessionAuthority(terminal.handle)).toMatchObject({
      handle: terminal.handle,
      ptyId: 'ssh:worker@@relay-pty',
      incarnationId: 'meeting-claude',
      executionHostId: 'ssh:worker',
      connected: true,
      worktreeId: TEST_WORKTREE_ID
    })
    expect(runtime.resolveTerminalSessionAuthority('unknown-terminal')).toBeNull()

    vi.mocked(requireManagerPrincipal).mockReturnValue(principal)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this authority path only reads managerPrincipals.authorize.
    const db = {
      managerPrincipals: { authorize: () => principal }
    } as ReturnType<typeof runtime.getOrchestrationDb>
    vi.spyOn(runtime, 'getOrchestrationDb').mockReturnValue(db)
    vi.spyOn(runtime, 'listRepos').mockReturnValue([
      {
        id: 'repo-1',
        path: '/tmp/worktree-a',
        displayName: 'Work',
        badgeColor: 'blue',
        addedAt: 1,
        connectionId: 'worker'
      }
    ])
    const params = {
      serviceToken: 'configured-service-token',
      terminal: terminal.handle,
      incarnationId: 'meeting-claude'
    }
    expect(requireManagerSession(runtime, params, 'session:guide').terminal.handle).toBe(
      terminal.handle
    )
    expect(() =>
      requireManagerSession(runtime, { ...params, terminal: 'unknown-terminal' }, 'session:guide')
    ).toThrow('unverifiable')
    expect(() =>
      requireManagerSession(runtime, { ...params, incarnationId: 'old' }, 'session:guide')
    ).toThrow('changed')
    runtime.registerPty('ssh:other@@relay-pty', TEST_WORKTREE_ID, 'other', {
      tabId: 'other-recorded-tab',
      leafId: 'pane:2',
      incarnationId: 'other-agent'
    })
    const other = (await runtime.listTerminals(`id:${TEST_WORKTREE_ID}`)).terminals.find(
      (row) => row.ptyId === 'ssh:other@@relay-pty'
    )!
    expect(() =>
      requireManagerSession(
        runtime,
        { ...params, terminal: other.handle, incarnationId: 'other-agent' },
        'session:guide'
      )
    ).toThrow('outside')
    runtime.onPtyExit('ssh:worker@@relay-pty', 0)
    expect(() => requireManagerSession(runtime, params, 'session:guide')).toThrow('changed')
  })
})
