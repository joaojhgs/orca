import { createNotificationStreamFilter } from './notification-stream-policy'
import { defineStreamingMethod, defineMethod, type RpcContext } from '../../core'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import { notificationPolicyTargets } from '../../../../notifications/notification-policy-targets'
import { agentHookServer } from '../../../../agent-hooks/server/agent-hook-server'
import {
  NotificationGetMissedSinceParams,
  NotificationRegisterPushParams,
  NotificationReportDesktopPresenceParams,
  NotificationUnsubscribeParams,
  NotificationsSubscribeParams,
  NotificationPolicyTargetsParams,
  NotificationPolicyUpdateParams
} from '../../../../../shared/rpc-contract/notifications/notifications-params'

// Use a per-process counter so same-millisecond subscriptions cannot collide.
let notificationsSubscriptionSeq = 0

type DesktopPresenceReportContext = Pick<RpcContext, 'clientKind' | 'connectionId' | 'signal'> & {
  runtime: Pick<OrcaRuntimeService, 'reportDesktopClientPresence' | 'registerSubscriptionCleanup'>
}

/** Only a paired desktop's own socket speaks for a desktop; the report lives as long as it. */
export function reportDesktopPresence(
  params: { away: boolean },
  { runtime, clientKind, connectionId, signal }: DesktopPresenceReportContext
): { recorded: boolean } {
  // A closed socket already ran its cleanups, so a late report would never be forgotten.
  if (clientKind !== 'runtime' || !connectionId || signal?.aborted) {
    return { recorded: false }
  }
  runtime.reportDesktopClientPresence(connectionId, params.away, (forget) =>
    runtime.registerSubscriptionCleanup(`desktop-presence-${connectionId}`, forget, connectionId)
  )
  return { recorded: true }
}

// Legacy callers retain filtered socket alerts; push clients opt into the full event stream.
export const NOTIFICATION_METHODS = [
  defineMethod({
    name: 'notifications.policyRead',
    permission: 'settings-write',
    params: null,
    handler: (_params, { runtime }) => runtime.getNotificationPolicy()
  }),
  defineMethod({
    name: 'notifications.policyUpdate',
    permission: 'settings-write',
    params: NotificationPolicyUpdateParams,
    handler: (params, { runtime }) =>
      runtime.updateNotificationPolicy(params.policy, params.expectedRevision)
  }),
  defineMethod({
    name: 'notifications.policyDevices',
    permission: 'settings-write',
    params: null,
    handler: (_params, { deviceSelf }) => ({
      devices: deviceSelf?.listNotificationPolicyDevices?.() ?? []
    })
  }),
  defineMethod({
    name: 'notifications.policyTargets',
    permission: 'settings-write',
    params: NotificationPolicyTargetsParams,
    handler: (params, { runtime }) => {
      const rows = notificationPolicyTargets(runtime, agentHookServer.getEnrichedStatusSnapshot())
      const end = params.offset + params.limit
      return { targets: rows.slice(params.offset, end), nextOffset: end < rows.length ? end : null }
    }
  }),
  defineStreamingMethod({
    name: 'notifications.subscribe',
    permission: 'workspace',
    params: NotificationsSubscribeParams,
    handler: async (params, { runtime, connectionId, pairedDeviceId, clientKind }, emit) => {
      const shouldEmit = createNotificationStreamFilter(params?.includeDesktopSuppressed)
      await new Promise<void>((resolve) => {
        const unsubscribe = runtime.onNotificationDispatched((event) => {
          if (
            shouldEmit(event) &&
            (runtime.allowsMobileNotificationDelivery?.(
              event,
              pairedDeviceId,
              clientKind === 'runtime' ? 'desktop' : 'mobile'
            ) ??
              true)
          ) {
            emit(event)
          }
        })

        // Key cleanup by socket plus sequence so concurrent subscriptions cannot evict each other.
        const seq = ++notificationsSubscriptionSeq
        const subscriptionId = `notifications-${connectionId ?? 'inproc'}-${seq}`
        runtime.registerSubscriptionCleanup(
          subscriptionId,
          () => {
            unsubscribe()
            emit({ type: 'end' })
            resolve()
          },
          connectionId
        )

        // Send epoch before the reconnect watermark so getMissedSince knows the counter lifetime (#8591).
        emit({ type: 'ready', subscriptionId, epoch: runtime.getMobileNotificationEpoch() })
      })
    }
  }),
  defineMethod({
    name: 'notifications.unsubscribe',
    permission: 'workspace',
    params: NotificationUnsubscribeParams,
    handler: async (params, { runtime }) => {
      runtime.cleanupSubscription(params.subscriptionId)
      return { unsubscribed: true }
    }
  }),
  defineMethod({
    name: 'notifications.getMissedSince',
    permission: 'workspace',
    params: NotificationGetMissedSinceParams,
    // Runtime sequence/epoch is authoritative for notifications missed while the socket was reaped.
    handler: async (params, { runtime, pairedDeviceId, clientKind }) => {
      const missed = runtime.getMissedNotificationsSince(params.lastSeenSeq, params.epoch)
      return {
        notifications: missed.filter(
          (event) =>
            createNotificationStreamFilter(params.includeDesktopSuppressed)(event) &&
            (runtime.allowsMobileNotificationDelivery?.(
              event,
              pairedDeviceId,
              clientKind === 'runtime' ? 'desktop' : 'mobile'
            ) ??
              true)
        ),
        epoch: runtime.getMobileNotificationEpoch(),
        ...(params.deliveredPushes
          ? { dismissedPushes: runtime.reconcileDismissedPushes(params.deliveredPushes) }
          : {})
      }
    }
  }),
  defineMethod({
    name: 'notifications.reportDesktopPresence',
    permission: 'workspace',
    params: NotificationReportDesktopPresenceParams,
    handler: async (params, context) => reportDesktopPresence(params, context)
  }),
  defineMethod({
    name: 'notifications.registerPush',
    permission: 'pairing-admin',
    params: NotificationRegisterPushParams,
    // Register only the transport-proven revocable mobile device; CLI/in-process callers have no device identity.
    handler: async (params, { runtime, clientKind, pairedDeviceId }) => {
      if (clientKind !== 'mobile' || !pairedDeviceId) {
        return { registered: false, reason: 'not_mobile' }
      }
      // The paired identity is spread last so no parameter can ever override it.
      return await runtime.registerMobilePushDevice({ ...params, deviceId: pairedDeviceId })
    }
  }),
  defineMethod({
    name: 'notifications.testPush',
    permission: 'pairing-admin',
    params: null,
    handler: async (_params, { runtime, clientKind, pairedDeviceId }) => {
      if (clientKind !== 'mobile' || !pairedDeviceId) {
        return { accepted: false, reason: 'not_registered' }
      }
      return await runtime.testMobilePushDevice(pairedDeviceId)
    }
  }),
  defineMethod({
    name: 'notifications.unregisterPush',
    permission: 'pairing-admin',
    params: null,
    // Durable gateway deletion lets unregister succeed even while the gateway is offline.
    handler: async (_params, { runtime, clientKind, pairedDeviceId }) => {
      if (clientKind !== 'mobile' || !pairedDeviceId) {
        return { unregistered: false }
      }
      return await runtime.unregisterMobilePushDevice(pairedDeviceId)
    }
  })
]
