import { expect, it } from 'vitest'
import { agentNotificationStopPoint } from './agent-notification-stop-point'
import type { AgentHookEventPayload } from './agent-hook-listener/listener-event'

function event(
  message: string,
  agentType = 'hermes',
  state: 'done' | 'waiting' | 'blocked' = 'done'
): AgentHookEventPayload {
  return {
    paneKey: 'pane',
    connectionId: null,
    hookEventName: 'post_llm_call',
    payload: { state, prompt: '', agentType, lastAssistantMessage: message }
  }
}

it('suppresses bare Hermes silence markers without changing status evidence', () => {
  for (const marker of ['NO_REPLY', ' NO_REPLY\n', 'NO REPLY', '[SILENT]', 'SILENT']) {
    const row = event(marker)
    expect(agentNotificationStopPoint(row)).toBeNull()
    expect(row.payload.state).toBe('done')
  }
})

it('preserves questions, meaningful messages and other providers', () => {
  for (const state of ['waiting', 'blocked'] as const) {
    expect(agentNotificationStopPoint(event('NO_REPLY', 'hermes', state))).toBe(state)
  }
  expect(agentNotificationStopPoint(event('The NO_REPLY filter is fixed.'))).toBe('done')
  expect(agentNotificationStopPoint(event('NO_REPLY', 'claude'))).toBe('done')
  expect(agentNotificationStopPoint(event(''))).toBe('done')
  expect(agentNotificationStopPoint(event('[SILENT'))).toBe('done')
  const failed = event('NO_REPLY')
  failed.payload.mainAgent = { state: 'done', stateStartedAt: 0, outcome: 'failure' }
  expect(agentNotificationStopPoint(failed)).toBe('done')
})
