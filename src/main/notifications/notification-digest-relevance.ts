import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { MobileNotificationEvent } from '../runtime/runtime-mobile-notification-controller'
import { readManagerNotificationTarget } from '../../shared/manager-notification-target'
import { agentHookServer } from '../agent-hooks/server'
import { agentHookGeneration } from '../agent-hooks/agent-hook-generation'
import { getConnectionExecutionHostId } from '../../shared/execution-host'
import { agentNotificationStopPoint } from '../../shared/agent-notification-stop-point'
import { confirmAgentNotification } from './agent-notification-eligibility'
import { ManagerAuthorityError } from '../runtime/manager/manager-authority-error'

/** Null defers delivery when current execution evidence cannot be verified. */
export async function confirmNotificationDigestRelevance(
  runtime: Pick<OrcaRuntimeService, 'getExistingOrchestrationDb'>,
  event: MobileNotificationEvent
): Promise<boolean | null> {
  if (event.type !== 'notification') {
    return false
  }
  const target = readManagerNotificationTarget(event.notificationId)
  if (target) {
    const db = runtime.getExistingOrchestrationDb()
    if (!db) {
      return null
    }
    const run = db.getRun(target.runId)
    if (!run || String(run.consumer_generation) !== event.notificationScope?.sessionGeneration) {
      return false
    }
    try {
      const principalId = db.managerRuns.principalForRun(run)
      const principal = db.managerPrincipals.authorize(principalId, 'conversation:write')
      db.managerRuns.requireOwnedRun(principalId, run, principal.grant.scope)
      return Boolean(
        db.db
          .prepare(`SELECT 1 FROM manager_conversation_messages c
        WHERE c.message_id = ? AND c.run_id = ? AND c.role = 'manager' AND c.kind = 'question'
        AND NOT EXISTS (SELECT 1 FROM manager_conversation_messages a WHERE a.role = 'human' AND a.reply_to = c.message_id)`)
          .get(target.messageId, target.runId)
      )
    } catch (error) {
      return error instanceof ManagerAuthorityError ? false : null
    }
  }
  if (event.source !== 'agent-task-complete') {
    return true
  }
  const scope = event.notificationScope
  if (!scope?.sessionId || !scope.sessionGeneration || !scope.executionHostId) {
    return null
  }
  const rows = agentHookServer
    .getEnrichedStatusSnapshot()
    .filter(
      (row) =>
        getConnectionExecutionHostId(row.connectionId) === scope.executionHostId &&
        (row.providerSession?.id ?? row.paneKey) === scope.sessionId &&
        (!event.worktreeId || row.worktreeId === event.worktreeId)
    )
  if (
    rows.length !== 1 ||
    rows[0].restoredUnconfirmed ||
    rows[0].retainedForLiveness ||
    rows[0].isReplay
  ) {
    return null
  }
  const row = rows[0]
  if (
    agentHookGeneration(row) !== scope.sessionGeneration ||
    agentNotificationStopPoint(row) !== event.agentState
  ) {
    return false
  }
  const confirmed = await confirmAgentNotification(row)
  return confirmed && agentHookServer.getEnrichedStatusSnapshot().some((current) => current === row)
    ? true
    : null
}
