import { createHash } from 'node:crypto'
import type { EnrichedAgentHookEventPayload } from '../../agent-hooks/server/server-types'
import type { ManagerEventInput, ManagerEventScope } from '../../../shared/manager-event-contract'
import { agentMainAgentVerdict } from '../../../shared/agent-main-agent-verdict'
import { agentHookGeneration } from '../../agent-hooks/agent-hook-generation'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

/** A turn boundary asks the manager to inspect evidence; it never settles a Task. */
export function managerHookEvent(
  event: EnrichedAgentHookEventPayload,
  scope: ManagerEventScope
): ManagerEventInput | null {
  if (
    scope.actor === 'manager' ||
    event.isReplay ||
    event.restoredUnconfirmed ||
    event.providerSessionOnly ||
    event.retainedForLiveness ||
    event.toolAgentId ||
    event.teammateName ||
    event.observation?.kind === 'snapshot' ||
    event.observation?.kind === 'identity-only'
  ) {
    return null
  }
  const payload = event.payload
  const state = payload.mainAgent?.state ?? payload.state
  if (state === 'working' || payload.sessionBoundary) {
    return null
  }
  const verdict = agentMainAgentVerdict(payload)
  const kind =
    state === 'blocked'
      ? 'permission-wait'
      : state === 'waiting'
        ? 'question'
        : verdict === 'failure' || verdict === 'interruption'
          ? 'failure'
          : 'turn-complete'
  const occurredAt =
    payload.mainAgent?.stateStartedAt ?? payload.turnCompletedAt ?? event.stateStartedAt
  const sourceGeneration = agentHookGeneration(event)
  const summary = (
    state === 'waiting' || state === 'blocked'
      ? (payload.interactivePrompt ?? payload.toolInput ?? payload.prompt)
      : (payload.lastAssistantMessage ?? '')
  ).slice(0, 4096)
  const qualifiedScope: ManagerEventScope = {
    ...scope,
    sessionId: scope.sessionId ?? event.providerSession?.id ?? event.paneKey,
    sessionGeneration: sourceGeneration
  }
  return {
    eventId: `hook_${hash(JSON.stringify([qualifiedScope, sourceGeneration, kind, occurredAt, summary]))}`,
    source: 'hook-store',
    sourceGeneration,
    kind,
    scope: qualifiedScope,
    occurredAt,
    summary,
    ...(kind === 'failure' ? { outcome: 'failed' as const } : {})
  }
}
