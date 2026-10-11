import { beforeEach, expect, it, vi } from 'vitest'
import { confirmNotificationDigestRelevance } from './notification-digest-relevance'
import { agentHookServer } from '../agent-hooks/server'
import { confirmAgentNotification } from './agent-notification-eligibility'
import { agentHookGeneration } from '../agent-hooks/agent-hook-generation'
import type { EnrichedAgentHookEventPayload } from '../agent-hooks/server/server-types'
import type { MobileNotificationDispatchEvent } from '../runtime/runtime-mobile-notification-controller'

vi.mock('../agent-hooks/server', () => ({
  agentHookServer: { getEnrichedStatusSnapshot: vi.fn() }
}))
vi.mock('./agent-notification-eligibility', () => ({ confirmAgentNotification: vi.fn() }))
const runtime = { getExistingOrchestrationDb: () => null }
function fixture() {
  const row: EnrichedAgentHookEventPayload = {
    paneKey: 'pane',
    connectionId: 'desktop',
    worktreeId: 'folder:project',
    receivedAt: 1,
    stateStartedAt: 1,
    launchToken: 'original',
    providerSession: { id: 'session', key: 'session_id' },
    payload: { agentType: 'codex', state: 'done', prompt: '' }
  }
  const event: MobileNotificationDispatchEvent = {
    type: 'notification',
    source: 'agent-task-complete',
    agentState: 'done',
    worktreeId: row.worktreeId,
    title: 'Recorded stop',
    body: '',
    notificationScope: {
      executionHostId: 'ssh:desktop',
      sessionId: 'session',
      sessionGeneration: agentHookGeneration(row)
    }
  }
  vi.mocked(agentHookServer.getEnrichedStatusSnapshot).mockReturnValue([row])
  return { row, event }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(confirmAgentNotification).mockResolvedValue(true)
})
it('requires current matching execution evidence for a recorded remote folder stop', async () => {
  const f = fixture()
  expect(await confirmNotificationDigestRelevance(runtime, f.event)).toBe(true)
  expect(confirmAgentNotification).toHaveBeenCalledExactlyOnceWith(f.row)
})
it.each(['absent', 'retained', 'restored', 'replay'] as const)(
  'defers %s contact/evidence without claiming completion',
  async (kind) => {
    const f = fixture()
    if (kind === 'absent') {
      vi.mocked(agentHookServer.getEnrichedStatusSnapshot).mockReturnValue([])
    }
    if (kind === 'retained') {
      f.row.retainedForLiveness = true
    }
    if (kind === 'restored') {
      f.row.restoredUnconfirmed = true
    }
    if (kind === 'replay') {
      f.row.isReplay = true
    }
    expect(await confirmNotificationDigestRelevance(runtime, f.event)).toBeNull()
    expect(confirmAgentNotification).not.toHaveBeenCalled()
  }
)
it.each(['replaced', 'resumed', 'child'] as const)(
  'retires a %s stop before delivery',
  async (kind) => {
    const f = fixture()
    if (kind === 'replaced') {
      f.row.launchToken = 'replacement'
    }
    if (kind === 'resumed') {
      f.row.payload.state = 'working'
    }
    if (kind === 'child') {
      f.row.hookEventName = 'SubagentStop'
    }
    expect(await confirmNotificationDigestRelevance(runtime, f.event)).toBe(false)
    expect(confirmAgentNotification).not.toHaveBeenCalled()
  }
)
it('defers an unreadable observer or a status replacement during confirmation', async () => {
  const f = fixture()
  vi.mocked(confirmAgentNotification).mockResolvedValueOnce(false)
  expect(await confirmNotificationDigestRelevance(runtime, f.event)).toBeNull()
  vi.mocked(confirmAgentNotification).mockImplementationOnce(async () => {
    vi.mocked(agentHookServer.getEnrichedStatusSnapshot).mockReturnValue([])
    return true
  })
  expect(await confirmNotificationDigestRelevance(runtime, f.event)).toBeNull()
})
