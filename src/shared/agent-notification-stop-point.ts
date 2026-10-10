import type { AgentHookEventPayload } from './agent-hook-listener/listener-event'
import { agentMainAgentVerdict } from './agent-main-agent-verdict'
import { isAgentStatusHeldOpenByChildWork } from './agent-lead-status-fold'

/** Notification policy is intentionally narrower than the combined pane's display state. */
export function agentNotificationStopPoint(event: AgentHookEventPayload) {
  if (
    event.isReplay ||
    event.restoredUnconfirmed ||
    event.providerSessionOnly ||
    event.payload.sessionBoundary ||
    /^(Subagent|SubAgent|Teammate)/i.test(event.hookEventName ?? '')
  ) {
    return null
  }
  const state = event.payload.mainAgent?.state ?? event.payload.state
  const verdict = agentMainAgentVerdict(event.payload)
  if (['cancellation', 'superseded', 'unconfirmed', 'interruption'].includes(verdict ?? '')) {
    return null
  }
  if (state === 'waiting' || state === 'blocked') {
    return state
  }
  // Transcript/child-roster refreshes can drain the pane without a new root stop.
  if (
    state === 'done' &&
    event.payload.agentType === 'codex' &&
    event.payload.mainAgent &&
    event.hookEventName !== 'Stop'
  ) {
    return null
  }
  return state === 'done' && !isAgentStatusHeldOpenByChildWork(event.payload) ? state : null
}

export function isAgentHumanQuestion(event: AgentHookEventPayload): boolean {
  return /^(request_user_input|AskUserQuestion|ask_user_question)$/i.test(
    event.payload.toolName ?? ''
  )
}
