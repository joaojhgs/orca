import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagerConversationMessage } from '../../../src/shared/manager-conversation-contract'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { FakeSession } from '../transport/mobile-endpoint-supervisor-test-fakes'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'

const mocks = vi.hoisted(() => ({
  storage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
  randomUUID: vi.fn(),
  appState: { currentState: 'active', addEventListener: vi.fn(() => ({ remove: vi.fn() })) }
}))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: mocks.storage }))
vi.mock('react-native', () => ({ AppState: mocks.appState }))
vi.mock('expo-crypto', () => ({ randomUUID: mocks.randomUUID }))
import {
  managerReceiptOwnerKey,
  nativeManagerReceiptStore,
  readMobileManagerReceipt,
  saveMobileManagerReceipt
} from './mobile-manager-request-store'
import {
  useMobileManagerConversations,
  type MobileManagerConversations
} from './use-mobile-manager-conversations'

const owner = managerReceiptOwnerKey('controller', 'private-pairing')
const scope = {
  executionHostId: 'ssh:worker',
  workspaceId: 'folder:project',
  runId: 'run-1',
  actor: 'manager' as const
}
const principal = {
  id: 'principal-1',
  label: 'Hermes',
  createdAt: 0,
  expiresAt: 9999999999999,
  actions: ['run:create'],
  state: 'active',
  consumerConnected: false
}
const question: ManagerConversationMessage = {
  id: 'question-1',
  runId: 'run-1',
  sequence: 1,
  role: 'manager',
  kind: 'question',
  body: 'Which approach?',
  replyTo: null,
  createdAt: '2026-10-10T20:00:00Z'
}
const created = {
  run: { id: 'run-1', objective: 'Build project' },
  scope,
  messages: [],
  nextSequence: 0,
  hasMore: false
}
function success(result: unknown): RpcResponse {
  return { id: 'reply', ok: true, result }
}

function mount(client: RpcClient, initialRunId?: string, foreground = false) {
  const receipts = nativeManagerReceiptStore(owner)
  let latest: MobileManagerConversations | null = null
  function Probe(props: { foreground: boolean }) {
    latest = useMobileManagerConversations(client, receipts, props.foreground, initialRunId)
    return null
  }
  let renderer: ReturnType<typeof create>
  act(() => {
    renderer = create(createElement(Probe, { foreground }))
  })
  return {
    get current(): MobileManagerConversations {
      if (!latest) {
        throw new Error('Probe did not render')
      }
      return latest
    },
    async settle() {
      await act(async () => {
        await Promise.resolve()
      })
    },
    async perform(action: (state: MobileManagerConversations) => Promise<boolean>) {
      let accepted = false
      await act(async () => {
        accepted = await action(this.current)
      })
      return accepted
    },
    setForeground(value: boolean) {
      act(() => renderer.update(createElement(Probe, { foreground: value })))
    },
    close() {
      act(() => renderer.unmount())
    }
  }
}

describe('native manager conversation lifecycle', () => {
  let values: Map<string, string>
  let client: FakeSession
  let messages: ManagerConversationMessage[]
  let principalState: string
  const probes: ReturnType<typeof mount>[] = []
  beforeEach(() => {
    vi.clearAllMocks()
    values = new Map()
    messages = []
    principalState = 'active'
    mocks.storage.getItem.mockImplementation(async (key: string) => values.get(key) ?? null)
    mocks.storage.setItem.mockImplementation(async (key: string, value: string) => {
      values.set(key, value)
    })
    mocks.storage.removeItem.mockImplementation(async (key: string) => {
      values.delete(key)
    })
    let nextId = 1
    mocks.randomUUID.mockImplementation(() => `request-${nextId++}`)
    mocks.appState.currentState = 'active'
    client = new FakeSession('connected')
    client.sendRequest.mockImplementation(async (method, input) => {
      if (method === 'manager.principalsList') {
        return success({ principals: [{ ...principal, state: principalState }], nextOffset: null })
      }
      if (method === 'manager.conversationsList') {
        return success({
          conversations: [
            { runId: 'run-1', principalId: 'principal-1', objective: created.run.objective, scope }
          ],
          nextOffset: null
        })
      }
      if (method === 'manager.conversationShow') {
        const after =
          input && typeof input === 'object' && 'afterSequence' in input ? input.afterSequence : 0
        if (typeof after !== 'number') {
          throw new Error('Invalid cursor')
        }
        const page = messages.filter((message) => message.sequence > after)
        return success({
          run: created.run,
          principalId: 'principal-1',
          messages: page,
          nextSequence: page.at(-1)?.sequence ?? after,
          hasMore: false
        })
      }
      if (method === 'manager.conversationCreate') {
        return success(created)
      }
      if (method === 'manager.conversationSend') {
        return success({ messageId: 'human-1', accepted: true, delivery: 'queued' })
      }
      if (method === 'worktree.ps') {
        return success({
          truncated: false,
          worktrees: [
            {
              worktreeId: 'folder:project',
              hostId: 'ssh:worker',
              displayName: 'Project',
              isArchived: false
            }
          ]
        })
      }
      throw new Error(`Unexpected method: ${method}`)
    })
  })
  afterEach(() => {
    for (const probe of probes.splice(0)) {
      probe.close()
    }
    vi.useRealTimers()
  })
  function probe(initialRunId?: string, foreground = false) {
    const result = mount(client, initialRunId, foreground)
    probes.push(result)
    return result
  }

  it('persists and verifies the exact objective before putting it on the wire', async () => {
    const view = probe()
    await view.settle()
    const usual = client.sendRequest.getMockImplementation()
    client.sendRequest.mockImplementation(async (method, input) => {
      if (method === 'manager.conversationCreate') {
        expect(await readMobileManagerReceipt(owner)).toEqual({
          kind: 'create',
          requestId: 'request-1',
          principalId: 'principal-1',
          workspaceId: 'folder:project',
          objective: 'Build project'
        })
      }
      if (!usual) {
        throw new Error('Missing responder')
      }
      return usual(method, input)
    })
    expect(
      await view.perform((state) => state.create('principal-1', 'folder:project', 'Build project'))
    ).toBe(true)
    expect(view.current.runId).toBe('run-1')
    expect(view.current.pending).toBeNull()
    expect(view.current.notice).toContain('not been confirmed started')
    expect(await readMobileManagerReceipt(owner)).toBeNull()
  })

  it('restores an unknown-delivery request after remount and retries without a new ID', async () => {
    const view = probe()
    await view.settle()
    client.sendRequest.mockRejectedValueOnce(
      markRpcDeliveryUnknown(new Error('lost acknowledgement'))
    )
    expect(
      await view.perform((state) => state.create('principal-1', 'folder:project', 'Build project'))
    ).toBe(false)
    expect(view.current.pending?.requestId).toBe('request-1')
    expect(
      await view.perform((state) => state.create('principal-1', 'folder:project', 'Duplicate'))
    ).toBe(false)
    expect(client.sendRequest).toHaveBeenCalledTimes(1)
    view.close()
    probes.splice(probes.indexOf(view), 1)
    const recovered = probe()
    await recovered.settle()
    const restored = recovered.current.pending
    expect(restored?.requestId).toBe('request-1')
    expect(await recovered.perform((state) => state.retry())).toBe(true)
    const writes = client.sendRequest.mock.calls.filter(
      ([method]) => method === 'manager.conversationCreate'
    )
    expect(writes).toHaveLength(2)
    expect(writes[1]?.[1]).toEqual(writes[0]?.[1])
  })

  it('clears a new definite refusal but preserves a previously uncertain receipt', async () => {
    const view = probe()
    await view.settle()
    const refused: RpcResponse = {
      id: 'reply',
      ok: false,
      error: { code: 'manager_forbidden', message: 'Revoked' }
    }
    client.sendRequest.mockResolvedValueOnce(refused)
    await view.perform((state) => state.create('principal-1', 'folder:project', 'Build project'))
    expect(view.current.pending).toBeNull()
    await saveMobileManagerReceipt(owner, {
      kind: 'send',
      requestId: 'uncertain',
      runId: 'run-1',
      body: 'Follow up'
    })
    view.close()
    probes.splice(probes.indexOf(view), 1)
    const recovered = probe()
    await recovered.settle()
    client.sendRequest.mockResolvedValueOnce(refused)
    expect(await recovered.perform((state) => state.retry())).toBe(false)
    expect(recovered.current.pending?.requestId).toBe('uncertain')
  })

  it('blocks writes on broken storage while still allowing catalog reads', async () => {
    mocks.storage.getItem.mockRejectedValue(new Error('storage unavailable'))
    const view = probe()
    await view.settle()
    expect(view.current.recoveryReady).toBe(false)
    expect(await view.perform((state) => state.refresh())).toBe(true)
    expect(view.current.catalog?.principals).toHaveLength(1)
    expect(
      await view.perform((state) => state.create('principal-1', 'folder:project', 'Build project'))
    ).toBe(false)
    expect(
      client.sendRequest.mock.calls.some(([method]) => method === 'manager.conversationCreate')
    ).toBe(false)
  })

  it('retains an accepted send outcome when a subsequent view refresh fails', async () => {
    const view = probe('run-1')
    await view.settle()
    client.sendRequest.mockResolvedValueOnce(
      success({ messageId: 'human-1', accepted: true, delivery: 'queued' })
    )
    client.sendRequest.mockRejectedValueOnce(new Error('catalog offline'))
    expect(await view.perform((state) => state.send('Confirmed message'))).toBe(true)
    expect(view.current.pending).toBeNull()
    expect(view.current.error).toContain('request was accepted')
  })

  it('records an exact question reply and exposes a revoked principal as read-only', async () => {
    messages = [question]
    const view = probe('run-1')
    await view.settle()
    await view.perform((state) => state.refresh())
    expect(view.current.detail?.messages).toEqual([question])
    expect(await view.perform((state) => state.send('Use approach A', question.id))).toBe(true)
    expect(client.sendRequest).toHaveBeenCalledWith('manager.conversationSend', {
      requestId: 'request-1',
      runId: 'run-1',
      body: 'Use approach A',
      replyTo: question.id
    })
    principalState = 'revoked'
    await view.perform((state) => state.refresh())
    expect(view.current.catalog?.principals[0]?.state).toBe('revoked')
    expect(view.current.detail?.messages).toEqual([question])
  })

  it('does not publish delayed mutation results into an unmounted controller surface', async () => {
    const view = probe()
    await view.settle()
    let resolve: ((reply: RpcResponse) => void) | undefined
    client.sendRequest.mockImplementationOnce(
      () =>
        new Promise((complete) => {
          resolve = complete
        })
    )
    let settled: Promise<boolean> | undefined
    await act(async () => {
      settled = view.current.create('principal-1', 'folder:project', 'Build project')
      await Promise.resolve()
    })
    view.close()
    probes.splice(probes.indexOf(view), 1)
    if (!resolve || !settled) {
      throw new Error('Mutation did not reach the wire')
    }
    resolve(success(created))
    expect(await settled).toBe(false)
    expect((await readMobileManagerReceipt(owner))?.requestId).toBe('request-1')
  })

  it('polls only while foreground and the OS app is active', async () => {
    vi.useFakeTimers()
    const view = probe('run-1', true)
    await view.settle()
    expect(client.notifyForeground).toHaveBeenCalledWith('focus')
    client.sendRequest.mockClear()
    mocks.appState.currentState = 'background'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(client.sendRequest).not.toHaveBeenCalled()
    mocks.appState.currentState = 'active'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(client.sendRequest).toHaveBeenCalledWith('manager.conversationShow', {
      runId: 'run-1',
      afterSequence: 0,
      limit: 50
    })
    view.setForeground(false)
    client.sendRequest.mockClear()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(client.sendRequest).not.toHaveBeenCalled()
  })

  it('pages conversation history with the exact sequence without losing earlier messages', async () => {
    const usual = client.sendRequest.getMockImplementation()
    client.sendRequest.mockImplementation(async (method, input) => {
      if (method === 'manager.conversationShow') {
        const after =
          input && typeof input === 'object' && 'afterSequence' in input ? input.afterSequence : 0
        const first = after === 0
        return success({
          run: created.run,
          principalId: 'principal-1',
          messages: first
            ? [question]
            : [{ ...question, id: 'report-2', sequence: 2, kind: 'reply', body: 'Second message' }],
          nextSequence: first ? 1 : 2,
          hasMore: first
        })
      }
      if (!usual) {
        throw new Error('Missing responder')
      }
      return usual(method, input)
    })
    const view = probe('run-1')
    await view.settle()
    await view.perform((state) => state.refresh())
    expect(view.current.detail?.hasMore).toBe(true)
    await view.perform((state) => state.loadMore())
    expect(view.current.detail?.messages.map((message) => message.id)).toEqual([
      'question-1',
      'report-2'
    ])
    expect(view.current.detail?.hasMore).toBe(false)
    expect(client.sendRequest).toHaveBeenCalledWith('manager.conversationShow', {
      runId: 'run-1',
      afterSequence: 1,
      limit: 50
    })
  })

  it('loads additional objective pages from the server cursor', async () => {
    const usual = client.sendRequest.getMockImplementation()
    client.sendRequest.mockImplementation(async (method, input) => {
      if (method === 'manager.conversationsList') {
        const offset = input && typeof input === 'object' && 'offset' in input ? input.offset : 0
        const first = offset === 0
        const id = first ? 'run-1' : 'run-2'
        return success({
          conversations: [
            { runId: id, principalId: 'principal-1', objective: id, scope: { ...scope, runId: id } }
          ],
          nextOffset: first ? 50 : null
        })
      }
      if (!usual) {
        throw new Error('Missing responder')
      }
      return usual(method, input)
    })
    const view = probe()
    await view.settle()
    await view.perform((state) => state.refresh())
    await view.perform((state) => state.moreConversations())
    expect(view.current.catalog?.conversations.map((row) => row.runId)).toEqual(['run-1', 'run-2'])
    expect(view.current.catalog?.nextOffset).toBeNull()
    expect(client.sendRequest).toHaveBeenCalledWith('manager.conversationsList', {
      offset: 50,
      limit: 50
    })
  })
})
