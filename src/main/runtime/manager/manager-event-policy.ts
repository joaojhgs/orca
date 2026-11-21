import type { ManagerEventInput } from '../../../shared/manager-event-contract'
import {
  resolveNotificationScopePolicy,
  type NotificationScopePolicy,
  type NotificationPolicyKind
} from '../../../shared/notification-scope-policy'

export function managerEventPolicyAllows(
  policy: NotificationScopePolicy | undefined,
  event: ManagerEventInput
): boolean {
  const kind: NotificationPolicyKind =
    event.kind === 'turn-complete' || event.kind === 'dispatch-settled'
      ? 'completion'
      : event.kind === 'permission-wait'
        ? 'permission'
        : event.kind === 'mail'
          ? 'progress'
          : event.kind
  return resolveNotificationScopePolicy(policy, event.scope, kind, 'mobile').manager
}
