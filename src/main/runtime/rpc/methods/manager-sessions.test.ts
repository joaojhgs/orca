import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'
import { MANAGER_SESSION_METHODS } from './manager-sessions'
import { requireManagerSession } from '../../manager/manager-session-authority'
import { requireManagerPrincipal } from '../../manager/manager-runtime-authority'

vi.mock('../../manager/manager-session-authority', () => ({ requireManagerSession: vi.fn() }))
vi.mock('../../manager/manager-runtime-authority', () => ({ requireManagerPrincipal: vi.fn() }))
const read = MANAGER_SESSION_METHODS.find((m) => m.name === 'manager.sessionRead')!
const guide = MANAGER_SESSION_METHODS.find((m) => m.name === 'manager.sessionGuide')!
const list = MANAGER_SESSION_METHODS.find((m) => m.name === 'manager.sessionList')!
const params = {
  serviceToken: `orcam_${'a'.repeat(43)}`,
  terminal: 'user-started',
  incarnationId: 'incarnation',
  requestId: 'same-guidance',
  lease: { principalId: 'principal', consumerId: 'coding', generation: 1 },
  body: 'Checkpoint please'
}

function fixture() {
  let stored:
    | { method: string; payload_hash: string; state: string; receipt: string | null }
    | undefined
  const db = {
    managerPrincipals: {
      withLease: vi.fn((_lease, _action, fn) => fn()),
      authorize: () => ({
        grant: {
          scope: { executionHostIds: ['ssh:worker'], projectIds: ['repo:repo'], runIds: [] }
        }
      })
    },
    getMutationReceipt: vi.fn(() => stored),
    beginMutationReceipt: vi.fn((identity) => {
      if (stored) {
        return { disposition: 'pending' }
      }
      stored = {
        method: identity.method,
        payload_hash: identity.payloadHash,
        state: 'pending',
        receipt: null
      }
      return { disposition: 'started' }
    }),
    checkpointPendingMutationReceipt: vi.fn(),
    completeMutationReceipt: vi.fn((identity) => {
      if (stored) {
        stored.state = 'completed'
        stored.receipt = identity.receipt
      }
    })
  }
  const runtime = {
    getOrchestrationDb: () => db,
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
    listFolderWorkspaces: () => [],
    listTerminals: vi.fn(async () => ({
      terminals: [
        {
          handle: 'manual',
          worktreeId: 'repo::/repo',
          executionHostId: 'ssh:worker',
          incarnationId: 'incarnation',
          title: 'Root',
          connected: true,
          writable: true,
          preview: 'PRIVATE_OUTPUT'
        },
        {
          handle: 'foreign',
          worktreeId: 'repo::/repo',
          executionHostId: 'ssh:other',
          preview: 'FOREIGN_OUTPUT'
        }
      ],
      truncated: false
    })),
    isTerminalRunningAgent: vi.fn(async () => true),
    readTerminal: vi.fn(async () => ({ lines: ['Evidence'] })),
    sendTerminalAgentPrompt: vi.fn(async (_terminal, _body, options) => {
      await options.beforeWrite()
      return { accepted: true, bytesWritten: 10 }
    })
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: handlers only reach the explicitly mocked runtime methods above.
  const context = { runtime } as unknown as RpcContext
  return { context, runtime, db }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireManagerPrincipal).mockReturnValue({
    id: 'principal',
    label: 'Coding',
    createdAt: 1,
    expiresAt: 1000,
    grant: {
      scope: { executionHostIds: ['ssh:worker'], projectIds: ['project'], runIds: [] },
      actions: ['session:read', 'session:guide']
    }
  })
  vi.mocked(requireManagerSession).mockReturnValue({
    principal: requireManagerPrincipal(undefined!, ''),
    terminal: {
      handle: 'user-started',
      tabId: 'tab',
      leafId: 'leaf',
      ptyId: 'pty',
      connected: true
    },
    scope: {
      projectId: 'project',
      executionHostId: 'ssh:worker',
      workspaceId: 'repo::/repo',
      actor: 'root'
    }
  })
})
describe('manager supervision of sessions it did not launch', () => {
  it('lists owner-started and unhooked terminals without leaking previews or foreign hosts', async () => {
    const f = fixture()
    const result = await list.handler(
      { serviceToken: params.serviceToken, offset: 0, limit: 1 },
      f.context
    )
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]).toMatchObject({
      terminal: 'manual',
      incarnationId: 'incarnation',
      ownership: 'unchanged'
    })
    expect(JSON.stringify(result)).not.toContain('PRIVATE_OUTPUT')
    expect(JSON.stringify(result)).not.toContain('FOREIGN_OUTPUT')
    expect(f.runtime.listTerminals).toHaveBeenCalledWith(undefined, 10000, {
      requireFreshPtyLiveness: true,
      includeVisualLayouts: false
    })
  })
  it('reads a user-started session without requiring a Run or Dispatch', async () => {
    const f = fixture()
    await expect(read.handler({ ...params, limit: 10 }, f.context)).resolves.toMatchObject({
      terminal: { lines: ['Evidence'] }
    })
    expect(requireManagerSession).toHaveBeenCalledTimes(2)
  })
  it('does not expose output after scope or incarnation changes during a read', async () => {
    const f = fixture()
    vi.mocked(requireManagerSession).mockImplementationOnce(() => {
      throw new Error('stale')
    })
    await expect(read.handler({ ...params, limit: 10 }, f.context)).rejects.toThrow('stale')
    expect(f.runtime.readTerminal).not.toHaveBeenCalled()
  })
  it('guides an existing agent once, preserving its owner and idempotent receipt', async () => {
    const f = fixture()
    const first = await guide.handler(params, f.context)
    expect(await guide.handler(params, f.context)).toEqual(first)
    expect(f.runtime.sendTerminalAgentPrompt).toHaveBeenCalledTimes(1)
    expect(first).toMatchObject({ ownership: 'unchanged', send: { accepted: true } })
    await expect(guide.handler({ ...params, body: 'Changed request' }, f.context)).rejects.toThrow(
      'different input'
    )
  })
  it('never sends model text to a shell', async () => {
    const f = fixture()
    f.runtime.isTerminalRunningAgent.mockResolvedValue(false)
    await expect(guide.handler(params, f.context)).rejects.toThrow('not a shell')
    expect(f.runtime.sendTerminalAgentPrompt).not.toHaveBeenCalled()
  })
  it('fences agent replacement immediately before writing', async () => {
    const f = fixture()
    f.runtime.isTerminalRunningAgent.mockResolvedValueOnce(true).mockResolvedValue(false)
    await expect(guide.handler(params, f.context)).rejects.toThrow('changed before')
    expect(f.db.completeMutationReceipt).not.toHaveBeenCalled()
    expect(await guide.handler(params, f.context)).toMatchObject({
      state: 'outcome_unknown',
      reconciliationRequired: true
    })
    expect(f.runtime.sendTerminalAgentPrompt).toHaveBeenCalledTimes(1)
  })
  it('does not duplicate concurrent guidance admitted during the foreground probe', async () => {
    const f = fixture()
    f.db.beginMutationReceipt.mockReturnValue({ disposition: 'pending' })
    expect(await guide.handler(params, f.context)).toMatchObject({ state: 'outcome_unknown' })
    expect(f.runtime.sendTerminalAgentPrompt).not.toHaveBeenCalled()
  })
})
