import { describe, expect, it, vi } from 'vitest'
import {
  createManagerConversation,
  mergeManagerConversationMessages,
  readManagerConversationCatalog,
  readManagerConversationPage,
  sendManagerConversationMessage
} from './manager-conversation-client'
import type { ManagerConversationMessage } from './manager-conversation-contract'

function message(sequence: number): ManagerConversationMessage {
  return {
    id: `message-${sequence}`,
    runId: 'run-1',
    sequence,
    role: 'manager',
    kind: 'reply',
    body: 'Reply',
    replyTo: null,
    createdAt: '2026-10-10T00:00:00Z'
  }
}
const page = (after = 0) => ({
  run: { id: 'run-1', objective: 'Goal' },
  principalId: 'manager-1',
  messages: [],
  nextSequence: after,
  hasMore: false
})

describe('manager conversation client contracts', () => {
  it('preserves the conversation offset while reading all principal pages', async () => {
    const principal = {
      id: 'manager-1',
      label: 'Hermes',
      actions: ['run:create'],
      state: 'active',
      consumerConnected: false,
      createdAt: 1,
      expiresAt: 2
    }
    const call = vi.fn(async (method: string, params: unknown) => {
      if (method === 'manager.conversationsList') {
        return { conversations: [], nextOffset: 50 }
      }
      return {
        principals:
          params && typeof params === 'object' && 'offset' in params && params.offset === 0
            ? [principal]
            : [],
        nextOffset:
          params && typeof params === 'object' && 'offset' in params && params.offset === 0
            ? 100
            : null
      }
    })
    const result = await readManagerConversationCatalog(call)
    expect(result.nextOffset).toBe(50)
    expect(result.principals).toEqual([principal])
    expect(call).toHaveBeenCalledWith('manager.principalsList', { offset: 100, limit: 100 })
  })

  it('rejects a non-advancing principal catalog', async () => {
    const call = vi.fn(async (method: string) =>
      method === 'manager.principalsList'
        ? { principals: [], nextOffset: 0 }
        : { conversations: [], nextOffset: null }
    )
    await expect(readManagerConversationCatalog(call)).rejects.toThrow('did not advance')
  })

  it('rejects a non-advancing objective catalog', async () => {
    const call = vi.fn(async (method: string) =>
      method === 'manager.principalsList'
        ? { principals: [], nextOffset: null }
        : { conversations: [], nextOffset: 50 }
    )
    await expect(readManagerConversationCatalog(call, 50)).rejects.toThrow('did not advance')
  })

  it('allows sparse canonical message sequences, merges overlaps once, and polls from the tail', async () => {
    const initial = {
      ...page(),
      messages: [message(2), message(8)],
      nextSequence: 8,
      hasMore: true
    }
    const call = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(page(8))
    expect(await readManagerConversationPage(call, 'run-1')).toEqual(initial)
    expect(await readManagerConversationPage(call, 'run-1', 8)).toEqual(page(8))
    expect(call).toHaveBeenLastCalledWith('manager.conversationShow', {
      runId: 'run-1',
      afterSequence: 8,
      limit: 50
    })
    expect(
      mergeManagerConversationMessages(initial.messages, [message(8), message(12)]).map(
        (entry) => entry.sequence
      )
    ).toEqual([2, 8, 12])
  })

  it.each([
    { ...page(), run: { id: 'other-run', objective: 'Goal' } },
    { ...page(), messages: [{ ...message(1), runId: 'other-run' }], nextSequence: 1 },
    { ...page(), messages: [message(2), message(1)], nextSequence: 1 },
    { ...page(), messages: [message(2)], nextSequence: 100 },
    { ...page(), hasMore: true }
  ])('refuses mismatched, reordered, skipped or stuck history %#', async (response) => {
    await expect(
      readManagerConversationPage(vi.fn().mockResolvedValue(response), 'run-1')
    ).rejects.toThrow('reconciliation')
  })

  it('does not interpret an absent or partial mutation response as success', async () => {
    const call = vi.fn().mockResolvedValue(undefined)
    await expect(
      createManagerConversation(call, {
        requestId: 'request-1',
        principalId: 'manager-1',
        workspaceId: 'folder:work',
        objective: 'Goal'
      })
    ).rejects.toThrow()
    await expect(
      sendManagerConversationMessage(call, {
        requestId: 'request-2',
        runId: 'run-1',
        body: 'Go ahead'
      })
    ).rejects.toThrow()
    call.mockResolvedValue({ messageId: 'message-1', accepted: true, delivery: 'queued' })
    await expect(
      sendManagerConversationMessage(call, {
        requestId: 'request-2',
        runId: 'run-1',
        body: 'Go ahead'
      })
    ).resolves.toMatchObject({ delivery: 'queued' })
  })
})
