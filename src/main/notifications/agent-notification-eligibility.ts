import {
  agentNotificationStopPoint,
  isAgentHumanQuestion
} from '../../shared/agent-notification-stop-point'
import { agentNotificationEvidenceSchema } from '../../shared/agent-notification-evidence'
import type { EnrichedAgentHookEventPayload } from '../agent-hooks/server/server-types'
import { executionObserverClient } from '../execution-observer/observer-client'
import { connectionManager } from '../ipc/ssh-ipc-context'
import type { NotificationDispatchRequest } from '../../shared/notification-settings-types'

export async function confirmNotificationRequest(
  request: NotificationDispatchRequest,
  getSnapshot: () => EnrichedAgentHookEventPayload[]
): Promise<boolean> {
  if (request.surface === 'agent-session') {
    return true
  }
  const rows = getSnapshot().filter(
    (row) =>
      row.paneKey === request.paneKey &&
      (!request.worktreeId || row.worktreeId === request.worktreeId)
  )
  if (rows.length !== 1) {
    return request.source === 'terminal-bell' && rows.length === 0
  }
  const row = rows[0]
  if (request.source === 'terminal-bell') {
    return false
  }
  if (
    request.agentState &&
    request.agentState !== (row.payload.mainAgent?.state ?? row.payload.state)
  ) {
    return false
  }
  if (!(await confirmAgentNotification(row))) {
    return false
  }
  return getSnapshot().some((current) => current === row)
}

/** Both desktop and serve use the same final host check; stale Stop hooks are not a stop point. */
export async function confirmAgentNotification(
  event: EnrichedAgentHookEventPayload
): Promise<boolean> {
  const stop = agentNotificationStopPoint(event)
  if (!stop || event.retainedForLiveness) {
    return false
  }
  if (event.payload.agentType !== 'codex') {
    return true
  }
  const sessionId = event.providerSession?.id
  if (!sessionId) {
    return false
  }
  try {
    const connection = event.connectionId
      ? connectionManager?.getConnection(event.connectionId)
      : undefined
    if (event.connectionId && !connection) {
      return false
    }
    const evidence = agentNotificationEvidenceSchema.parse(
      await executionObserverClient.observe(
        {
          operation: 'agent-notification-evidence',
          sessionId,
          transcriptPath: event.providerSession?.transcriptPath
        },
        connection
      )
    )
    if (event.connectionId && connectionManager?.getConnection(event.connectionId) !== connection) {
      return false
    }
    if (stop === 'done') {
      return evidence.state === 'done'
    }
    if (evidence.state !== 'working') {
      return false
    }
    // YOLO changes permissions, not the ability to ask the human an actual question.
    if (isAgentHumanQuestion(event)) {
      return true
    }
    return (
      evidence.approvalPolicy !== undefined &&
      evidence.approvalPolicy !== 'never' &&
      evidence.approvalsReviewer !== 'auto_review' &&
      evidence.approvalsReviewer !== 'guardian_subagent'
    )
  } catch {
    // Unreachable/unknown execution evidence must never be presented as a finished turn.
    return false
  }
}
