import { beforeEach, expect, it, vi } from 'vitest'
import type { EnrichedAgentHookEventPayload } from '../agent-hooks/server/server-types'
import {
  confirmAgentNotification,
  confirmNotificationRequest
} from './agent-notification-eligibility'
import { executionObserverClient } from '../execution-observer/observer-client'
import { agentHookGeneration } from '../agent-hooks/agent-hook-generation'

vi.mock('../execution-observer/observer-client', () => ({
  executionObserverClient: { observe: vi.fn() }
}))
vi.mock('../ipc/ssh-ipc-context', () => ({ connectionManager: null }))
beforeEach(() => {
  vi.mocked(executionObserverClient.observe).mockReset()
})
function event(state: 'done' | 'waiting'): EnrichedAgentHookEventPayload {
  return {
    paneKey: 'pane',
    connectionId: null,
    receivedAt: 1,
    stateStartedAt: 1,
    providerSession: { id: '01a112a5-d6bb-74e2-bf7c-ace73cb513b5', key: 'session_id' },
    payload: { agentType: 'codex', state, prompt: '' }
  }
}
it('rejects stale completions while the root is already working', async () => {
  vi.mocked(executionObserverClient.observe).mockResolvedValue({ state: 'working' })
  expect(await confirmAgentNotification(event('done'))).toBe(false)
})
it('allows a confirmed actual stop', async () => {
  vi.mocked(executionObserverClient.observe).mockResolvedValue({ state: 'done' })
  expect(await confirmAgentNotification(event('done'))).toBe(true)
})
it.each(['never', 'on-request'])(
  'only allows manual approval requests when policy is %s',
  async (approvalPolicy) => {
    vi.mocked(executionObserverClient.observe).mockResolvedValue({
      state: 'working',
      approvalPolicy,
      approvalsReviewer: 'user'
    })
    expect(await confirmAgentNotification(event('waiting'))).toBe(approvalPolicy !== 'never')
  }
)
it('keeps real main-agent questions in YOLO but not a child question', async () => {
  vi.mocked(executionObserverClient.observe).mockResolvedValue({
    state: 'working',
    approvalPolicy: 'never'
  })
  const question = event('waiting')
  question.payload.toolName = 'request_user_input'
  expect(await confirmAgentNotification(question)).toBe(true)
  question.payload.mainAgent = { state: 'working', stateStartedAt: 1 }
  expect(await confirmAgentNotification(question)).toBe(false)
})
it('rejects a child stop even when its root previously stopped', async () => {
  vi.mocked(executionObserverClient.observe).mockResolvedValue({ state: 'done' })
  const child = event('done')
  child.hookEventName = 'SubagentStop'
  expect(await confirmAgentNotification(child)).toBe(false)
  expect(executionObserverClient.observe).not.toHaveBeenCalled()
})
it('does not fall back to the controller for disconnected SSH evidence', async () => {
  const remote = event('done')
  remote.connectionId = 'offline-host'
  expect(await confirmAgentNotification(remote)).toBe(false)
  expect(executionObserverClient.observe).not.toHaveBeenCalled()
})
it('suppresses unreadable evidence and automatic reviewers', async () => {
  vi.mocked(executionObserverClient.observe).mockResolvedValue({
    state: 'working',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review'
  })
  expect(await confirmAgentNotification(event('waiting'))).toBe(false)
  vi.mocked(executionObserverClient.observe).mockRejectedValue(new Error('offline'))
  expect(await confirmAgentNotification(event('done'))).toBe(false)
})

it('applies the same host evidence veto to desktop delivery', async () => {
  const row = event('done')
  vi.mocked(executionObserverClient.observe).mockResolvedValue({ state: 'working' })
  expect(
    await confirmNotificationRequest(
      { source: 'agent-task-complete', paneKey: 'pane', agentState: 'done' },
      () => [row]
    )
  ).toBe(false)
  vi.mocked(executionObserverClient.observe).mockResolvedValue({ state: 'done' })
  expect(
    await confirmNotificationRequest(
      { source: 'agent-task-complete', paneKey: 'pane', agentState: 'done' },
      () => [row]
    )
  ).toBe(true)
})

it('rejects desktop notifications if the pane changes during host observation', async () => {
  const row = event('done')
  let snapshot = [row]
  vi.mocked(executionObserverClient.observe).mockImplementation(async () => {
    snapshot = []
    return { state: 'done' }
  })
  expect(
    await confirmNotificationRequest(
      { source: 'agent-task-complete', paneKey: 'pane' },
      () => snapshot
    )
  ).toBe(false)
})
it('rejects a delayed request after a different process generation occupies the same pane', async () => {
  const row = event('done')
  const oldGeneration = agentHookGeneration(row)
  row.launchToken = 'replacement'
  expect(
    await confirmNotificationRequest(
      {
        source: 'agent-task-complete',
        paneKey: row.paneKey,
        notificationScope: { sessionId: row.providerSession?.id, sessionGeneration: oldGeneration }
      },
      () => [row]
    )
  ).toBe(false)
  expect(executionObserverClient.observe).not.toHaveBeenCalled()
})

it('rejects child attention and agent bells on desktop without touching shell bells', async () => {
  const row = event('waiting')
  row.payload.mainAgent = { state: 'working', stateStartedAt: 1 }
  expect(
    await confirmNotificationRequest({ source: 'agent-task-complete', paneKey: 'pane' }, () => [
      row
    ])
  ).toBe(false)
  expect(
    await confirmNotificationRequest({ source: 'terminal-bell', paneKey: 'pane' }, () => [row])
  ).toBe(false)
  expect(
    await confirmNotificationRequest({ source: 'terminal-bell', paneKey: 'shell' }, () => [row])
  ).toBe(true)
})
