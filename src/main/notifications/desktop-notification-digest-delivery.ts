import type { NotificationDigestQueue } from './notification-digest-queue'
import type { DesktopDigestPayload } from './notification-digest-payload'
import { notificationDigestBody } from './notification-digest-payload'
import type {
  NotificationDispatchRequest,
  NotificationDispatchResult
} from '../../shared/notifications/notification-settings-types'
import { resolveNotificationScopePolicy } from '../../shared/notification-scope-policy'
import { notificationPolicyKind } from '../../shared/notification-policy-kind'
import type { NotificationDeliveryDependencies } from './notification-delivery-service'
export function startDesktopNotificationDigestDelivery(
  digestQueue: NotificationDigestQueue<DesktopDigestPayload> | null,
  deps: Pick<
    NotificationDeliveryDependencies,
    'readPolicyScope' | 'readNotificationSettings' | 'confirmDigestRelevant' | 'confirmStopPoint'
  >,
  dispatch: (
    request: NotificationDispatchRequest,
    summary: { title: string; body: string }
  ) => NotificationDispatchResult | Promise<NotificationDispatchResult>
): void {
  digestQueue?.start(async (items, isPending) => {
    const allowed: DesktopDigestPayload[] = []
    for (const item of items) {
      const scope = deps.readPolicyScope?.(item.request) ?? item.request.notificationScope ?? {}
      if (
        !resolveNotificationScopePolicy(
          deps.readNotificationSettings().scopePolicy,
          scope,
          notificationPolicyKind(item.request),
          'desktop'
        ).human
      ) {
        continue
      }
      const relevant = deps.confirmDigestRelevant
        ? await deps.confirmDigestRelevant(item.request)
        : await deps.confirmStopPoint?.(item.request)
      if (relevant === null) {
        return false
      }
      if (relevant === false || !isPending(item)) {
        continue
      }
      allowed.push(item)
    }
    const current = allowed.filter(isPending)
    const latest = current.at(-1)
    if (!latest) {
      return true
    }
    const result = await dispatch(latest.request, {
      title: latest.options.title,
      body: notificationDigestBody(current.length, latest.options.body)
    })
    return result.delivered || !['blocked-by-system', 'not-displayed'].includes(result.reason ?? '')
  })
}
