// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useManagerConversations } from './use-manager-conversations'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { readPendingManagerMutation } from './manager-conversation-request-receipts'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/runtime/runtime-rpc-client', async () => {
  const actual = await import('@/runtime/runtime-rpc-result')
  return { ...actual, callRuntimeRpc: mocks.call }
})
const target = { kind: 'environment', environmentId: 'controller-a' } as const
const principal = {
  id: 'manager-1',
  label: 'Hermes',
  actions: ['run:create', 'inventory:read'],
  state: 'active',
  consumerConnected: false,
  createdAt: 1,
  expiresAt: 2
}
const scope = {
  executionHostId: 'ssh:worker',
  projectId: 'project-1',
  workspaceId: 'repo::main',
  actor: 'root'
}
const created = {
  run: { id: 'run-1', objective: 'Goal' },
  scope,
  messages: [],
  nextSequence: 0,
  hasMore: false
}
const detail = {
  run: created.run,
  principalId: principal.id,
  messages: [],
  nextSequence: 0,
  hasMore: false
}

beforeEach(() => {
  window.sessionStorage.clear()
  mocks.call.mockReset()
  mocks.call.mockImplementation(async (_target, method) => {
    if (method === 'manager.principalsList') {
      return { principals: [principal], nextOffset: null }
    }
    if (method === 'manager.conversationsList') {
      return { conversations: [], nextOffset: null }
    }
    if (method === 'manager.conversationShow') {
      return detail
    }
    if (method === 'manager.conversationCreate') {
      return created
    }
    return { messageId: 'message-1', accepted: true, delivery: 'queued' }
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function ready(owner = 'controller-a:1') {
  const hook = renderHook(() => useManagerConversations(target, owner))
  await waitFor(() => expect(hook.result.current.catalog).not.toBeNull())
  return hook
}

describe('manager conversation presentation requests', () => {
  it('creates an objective once and says queued, not started', async () => {
    const hook = await ready()
    let accepted = false
    await act(async () => {
      accepted = await hook.result.current.create(principal.id, 'repo::main', 'Goal')
    })
    expect(accepted).toBe(true)
    expect(hook.result.current.runId).toBe('run-1')
    expect(hook.result.current.notice).toContain('not confirmation')
    expect(hook.result.current.pending).toBeNull()
    expect(readPendingManagerMutation('controller-a:1')).toBeNull()
  })

  it('retains the exact receipt after a lost response and across unmount/reload', async () => {
    const base = mocks.call.getMockImplementation()
    let failed = false
    mocks.call.mockImplementation(async (...args) => {
      if (args[1] === 'manager.conversationCreate' && !failed) {
        failed = true
        throw new Error('Request timed out')
      }
      return base?.(...args)
    })
    const hook = await ready()
    await act(async () => {
      await hook.result.current.create(principal.id, 'repo::main', 'Goal')
    })
    const pending = hook.result.current.pending
    expect(pending?.kind).toBe('create')
    hook.unmount()
    const restored = await ready()
    expect(restored.result.current.pending).toEqual(pending)
    await act(async () => {
      await restored.result.current.retry()
    })
    const sends = mocks.call.mock.calls.filter((args) => args[1] === 'manager.conversationCreate')
    expect(sends).toHaveLength(2)
    expect(sends[0][2]).toEqual(sends[1][2])
    expect(restored.result.current.runId).toBe('run-1')
    expect(restored.result.current.pending).toBeNull()
  })

  it('does not route an old receipt to another server or pairing generation', async () => {
    const hook = await ready()
    mocks.call.mockRejectedValueOnce(new Error('Connection lost'))
    await act(async () => {
      await hook.result.current.create(principal.id, 'repo::main', 'Goal')
    })
    hook.unmount()
    const other = await ready('controller-a:2')
    expect(other.result.current.pending).toBeNull()
    expect(readPendingManagerMutation('controller-a:1')).not.toBeNull()
  })

  it('releases a first, definitively denied request so its workspace can be corrected', async () => {
    const hook = await ready()
    mocks.call.mockRejectedValueOnce(
      new RuntimeRpcCallError({
        id: 'rpc-1',
        ok: false,
        error: { code: 'manager_forbidden', message: 'Workspace outside grant' }
      })
    )
    await act(async () => {
      await hook.result.current.create(principal.id, 'repo::outside', 'Goal')
    })
    expect(hook.result.current.pending).toBeNull()
    expect(hook.result.current.error).toContain('outside grant')
  })

  it('preserves a previously ambiguous receipt if a later retry is denied', async () => {
    const hook = await ready()
    mocks.call.mockRejectedValueOnce(new Error('Request timed out'))
    await act(async () => {
      await hook.result.current.create(principal.id, 'repo::main', 'Goal')
    })
    const pending = hook.result.current.pending
    mocks.call.mockRejectedValueOnce(
      new RuntimeRpcCallError({
        id: 'rpc-2',
        ok: false,
        error: { code: 'manager_forbidden', message: 'Credential now revoked' }
      })
    )
    await act(async () => {
      await hook.result.current.retry()
    })
    expect(hook.result.current.pending).toEqual(pending)
  })

  it('does not retry a committed reply when the following read fails', async () => {
    const hook = await ready()
    await act(async () => {
      await hook.result.current.create(principal.id, 'repo::main', 'Goal')
    })
    const base = mocks.call.getMockImplementation()
    mocks.call.mockImplementation(async (...args) => {
      if (args[1] === 'manager.principalsList') {
        throw new Error('Refresh unavailable')
      }
      return base?.(...args)
    })
    let accepted = false
    await act(async () => {
      accepted = await hook.result.current.send('Continue')
    })
    expect(accepted).toBe(true)
    expect(hook.result.current.pending).toBeNull()
    expect(hook.result.current.error).toBe('Refresh unavailable')
  })

  it('does not mark an undefined mutation response as accepted', async () => {
    const hook = await ready()
    mocks.call.mockResolvedValueOnce(undefined)
    await act(async () => {
      await hook.result.current.create(principal.id, 'repo::main', 'Goal')
    })
    expect(hook.result.current.pending).not.toBeNull()
    expect(hook.result.current.notice).toBeNull()
  })

  it('allows read-only navigation while preserving an unconfirmed request', async () => {
    const hook = await ready()
    mocks.call.mockRejectedValueOnce(new Error('Request timed out'))
    await act(async () => {
      await hook.result.current.create(principal.id, 'repo::main', 'Goal')
    })
    const pending = hook.result.current.pending
    await act(async () => hook.result.current.select('run-1'))
    expect(hook.result.current.detail?.run.id).toBe('run-1')
    expect(hook.result.current.pending).toEqual(pending)
  })

  it('fails closed without crashing when recovery storage is unavailable', async () => {
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('Storage denied')
    })
    const hook = await ready()
    expect(hook.result.current.recoveryBlocked).toBe(true)
    expect(hook.result.current.error).toContain('recovery storage')
    await act(async () => {
      await hook.result.current.create(principal.id, 'repo::main', 'Goal')
    })
    expect(
      mocks.call.mock.calls.filter((args) => args[1] === 'manager.conversationCreate')
    ).toHaveLength(0)
    await act(async () => hook.result.current.select('run-1'))
    expect(hook.result.current.detail?.run.id).toBe('run-1')
  })

  it('keeps loaded objective pages when the tab becomes visible again', async () => {
    const base = mocks.call.getMockImplementation()
    mocks.call.mockImplementation(async (...args) => {
      if (args[1] === 'manager.conversationsList') {
        const params = args[2]
        const older =
          params && typeof params === 'object' && 'offset' in params && params.offset === 50
        return {
          conversations: [
            {
              runId: older ? 'older-run' : 'run-1',
              principalId: principal.id,
              objective: older ? 'Older' : 'Goal',
              scope
            }
          ],
          nextOffset: older ? null : 50
        }
      }
      return base?.(...args)
    })
    const hook = await ready()
    await act(async () => {
      await hook.result.current.moreConversations()
    })
    await act(async () => hook.result.current.select('run-1'))
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(hook.result.current.catalog?.conversations.map((entry) => entry.runId)).toEqual([
      'run-1',
      'older-run'
    ])
  })
})
