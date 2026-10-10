import type { NotificationPolicyKind } from './notification-scope-policy'
import type { NotificationDispatchRequest } from './notification-settings-types'

export function notificationPolicyKind(
  request: Pick<
    NotificationDispatchRequest,
    'source' | 'agentState' | 'agentTurnOutcome' | 'notificationKind'
  >
): NotificationPolicyKind {
  if (request.notificationKind) {
    return request.notificationKind
  }
  if (request.source === 'test') {
    return 'test'
  }
  if (request.source === 'terminal-bell') {
    return 'bell'
  }
  if (request.agentState === 'blocked') {
    return 'permission'
  }
  if (request.agentState === 'waiting') {
    return 'question'
  }
  return request.agentTurnOutcome === 'failure' ? 'failure' : 'completion'
}
