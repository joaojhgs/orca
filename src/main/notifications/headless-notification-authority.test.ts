import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentHookServer } from '../agent-hooks/server'
import type { EnrichedAgentHookEventPayload } from '../agent-hooks/server/server-types'
import { PANE } from '../agent-hooks/server.test-fixtures'
import { AGENT_NOTIFICATION_QUIET_MS } from '../../shared/agent-notification-quiet-window'
import { createHeadlessNotificationDelivery } from './headless-notification-delivery'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(10000)
})
afterEach(() => vi.useRealTimers())

function fixture() {
  const server = new AgentHookServer()
  const dispatch = vi.fn()
  const delivery = createHeadlessNotificationDelivery({
    enabled: () => true,
    settings: () => ({
      enabled: true,
      agentTaskComplete: true,
      terminalBell: true,
      suppressWhenFocused: true,
      customSoundId: 'system',
      customSoundPath: null,
      customSoundVolume: 1
    }),
    dispatch,
    getStatusSnapshot: () => server.getEnrichedStatusSnapshot()
  })
  server.subscribeEnrichedStatus((event) => delivery.status(event))
  const status = (state: 'working' | 'done') => {
    const event: EnrichedAgentHookEventPayload = {
      paneKey: PANE,
      connectionId: 'worker',
      worktreeId: '/projects/aurora',
      providerSession: { key: 'session_id', id: 'test-root' },
      receivedAt: Date.now(),
      stateStartedAt: Date.now(),
      payload: { state, prompt: 'Build Aurora', agentType: 'codex' }
    }
    server.ingestRemote(event, 'worker')
    const accepted = server.getEnrichedStatusSnapshot()[0]
    if (!accepted) {
      throw new Error('Host did not admit the test status')
    }
    return accepted
  }
  return { server, delivery, dispatch, status }
}

it('uses the real host snapshot shape without changing the existing IPC projection', () => {
  const f = fixture()
  f.status('working')
  const done = f.status('done')
  expect(f.server.getStatusSnapshot()[0]).toMatchObject({ state: 'done' })
  expect(f.server.getEnrichedStatusSnapshot()[0]).toBe(done)
  vi.advanceTimersByTime(AGENT_NOTIFICATION_QUIET_MS)
  expect(f.dispatch).toHaveBeenCalledTimes(1)
})

it('does not push after authoritative removal or retention-only mutation', () => {
  for (const change of ['remove', 'retain'] as const) {
    const f = fixture()
    f.status('working')
    const done = f.status('done')
    f.server.dropStatusEntry(done.paneKey, { preserveResumeIdentity: change === 'retain' })
    vi.advanceTimersByTime(AGENT_NOTIFICATION_QUIET_MS)
    expect(f.dispatch).not.toHaveBeenCalled()
  }
})
