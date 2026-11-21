import { registerNotificationPermissionHandlers } from './notification-permission-ipc'
import { app, BrowserWindow, Notification, ipcMain, powerMonitor } from 'electron'
import { join } from 'node:path'
import { resolveNotificationPolicyScope } from '../../notifications/notification-policy-scope'
import { confirmNotificationRequest } from '../../notifications/agent-notification-eligibility'
import { confirmNotificationDigestRelevance } from '../../notifications/notification-digest-relevance'
import { agentHookServer } from '../../agent-hooks/server/agent-hook-server'
import { agentHookGeneration } from '../../agent-hooks/agent-hook-generation'
import type { NotificationDeliveryService } from '../../notifications/notification-delivery-service'
import { readDesktopAwayState } from '../../notifications/desktop-away-state'
import { closeDesktopNotification } from '../../notifications/desktop-notification'
import type { Store } from '../../persistence/loading-store/store'
import type {
  NotificationAttentionAcknowledgement,
  NotificationDismissResult,
  NotificationDispatchRequest,
  NotificationDispatchResult,
  StructuredNotificationRead
} from '../../../shared/notifications/notification-settings-types'
import { isNotificationAttentionAcknowledgement } from '../../../shared/notifications/notification-settings-types'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { readNotificationAuthorizationStatus } from './notification-authorization-status'
import { setTrayAttention } from '../../tray/system-tray'
import { isMainWindowVisible } from '../../window/visibility/main-window-visibility'
import { activeNotificationsById } from './native-notification-lifecycle'
import { deliverNativeNotification } from './native-notification-delivery'
import { removeReadMacosNotifications } from './macos-notification-center'
import { sessionRepliesInSlack } from '../../external-conversations/external-conversation-links'
import { createNotificationDeliveryService } from '../../notifications/notification-delivery-service'
import {
  createAnnouncedNotificationRegistry,
  type AnnouncedNotification
} from '../../notifications/announced-notification-registry'
import { registerNotificationSoundHandlers } from './notification-sound-ipc'
import { isStructuredAttentionRead } from '../../../shared/agent-session/view/agent-session-attention'
import { isAgentSessionExecutionLocation } from '../../../shared/agent-session/lifecycle/agent-session-record'
import { recordNotificationDeliveryOutcome } from './notification-permission-probe'

let currentDeliveryService: NotificationDeliveryService | null = null
let stopRuntimeAttentionEvents: (() => void) | undefined

export function registerNotificationHandlers(
  store: Parameters<typeof sessionRepliesInSlack>[0] &
    Pick<Store, 'getSettings' | 'getUI' | 'updateUI'> &
    Pick<Store, 'getRepos' | 'getProjectHostSetups' | 'getFolderWorkspaces'>,
  runtime?: OrcaRuntimeService
): void {
  currentDeliveryService?.dispose()
  ipcMain.removeHandler('notifications:getDesktopAwayState')
  ipcMain.handle('notifications:getDesktopAwayState', () => readDesktopAwayState(powerMonitor))
  registerNotificationPermissionHandlers(store)

  const announced = createAnnouncedNotificationRegistry()

  const closeNativeAnnouncements = (entries: readonly AnnouncedNotification[]): number => {
    let dismissed = 0
    for (const entry of entries) {
      const native = activeNotificationsById.get(entry.id)
      if (native) {
        closeDesktopNotification(native.notification)
        native.release()
        dismissed += 1
      }
    }
    return dismissed
  }
  const discardEvictedAnnouncements = (entries: readonly AnnouncedNotification[]): void => {
    closeNativeAnnouncements(entries)
    for (const entry of entries) {
      if (entry.paneKey && !entry.pendingOnly) {
        removeReadMacosNotifications(entry.paneKey, [entry], false)
      }
    }
  }

  const retireAnnouncements = (
    retired: readonly AnnouncedNotification[],
    paneKeys: string[] = []
  ): number => {
    const dismissed = closeNativeAnnouncements(retired)
    const byPane = new Map<string, AnnouncedNotification[]>(
      paneKeys.map((paneKey) => [paneKey, []])
    )
    for (const entry of retired) {
      if (entry.paneKey && !entry.pendingOnly) {
        const entries = byPane.get(entry.paneKey) ?? []
        entries.push(entry)
        byPane.set(entry.paneKey, entries)
      }
      if (!entry.origin && !entry.pendingOnly) {
        runtime?.dismissMobileNotification(entry.id)
      }
    }
    for (const [paneKey, entries] of byPane) {
      removeReadMacosNotifications(paneKey, entries, !announced.hasUnpositionedSubject(paneKey))
    }
    return dismissed
  }

  const acknowledge = (
    acknowledgement: NotificationAttentionAcknowledgement,
    executionHost?: NotificationDispatchRequest['executionHost']
  ): NotificationDismissResult => {
    if (!isNotificationAttentionAcknowledgement(acknowledgement)) {
      return { dismissed: 0 }
    }
    const retired = announced.takeAcknowledged(acknowledgement, executionHost)
    currentDeliveryService?.retireDigest(
      retired.map(({ id }) => id),
      [],
      []
    )
    if (executionHost) {
      runtime?.retireNotificationAttention?.(acknowledgement, executionHost)
    }
    return { dismissed: retireAnnouncements(retired) }
  }
  stopRuntimeAttentionEvents?.()
  stopRuntimeAttentionEvents = runtime?.onClientEvent?.(
    (event) => {
      if (event.type === 'notificationAttentionAcknowledged') {
        acknowledge(event.acknowledgement)
      }
    },
    { consumesTerminalSideEffects: false }
  )

  ipcMain.removeHandler('notifications:acknowledgeAttention')
  ipcMain.handle(
    'notifications:acknowledgeAttention',
    (
      _event,
      acknowledgement: NotificationAttentionAcknowledgement,
      executionHost?: NotificationDispatchRequest['executionHost']
    ) => acknowledge(acknowledgement, executionHost)
  )

  ipcMain.removeHandler('notifications:dismiss')
  ipcMain.handle(
    'notifications:dismiss',
    (
      _event,
      ids: string[],
      paneKeys?: string[],
      reads?: StructuredNotificationRead[]
    ): NotificationDismissResult => {
      const retired = new Map<string, AnnouncedNotification>()
      for (const id of ids.filter(
        (id) =>
          typeof id === 'string' &&
          id.length > 0 &&
          !id.startsWith('agent-attention:') &&
          !announced.isBounded(id) &&
          (!paneKeys?.length || !announced.hasAnnouncement({ notificationId: id }))
      )) {
        retired.set(id, { id })
      }
      for (const paneKey of Array.isArray(paneKeys) ? paneKeys : []) {
        if (typeof paneKey !== 'string') {
          continue
        }
        const read = Array.isArray(reads)
          ? reads.find((item) => isStructuredAttentionRead(item) && item.paneKey === paneKey)
          : undefined
        const entries = announced.take(paneKey, read)
        for (const entry of entries) {
          retired.set(entry.id, entry)
        }
        if (read) {
          runtime?.retireNotificationAttention?.({ reads: [read] }, read.executionHost)
        }
      }
      currentDeliveryService?.retireDigest(
        [...retired.keys()],
        Array.isArray(paneKeys) ? paneKeys.filter((key) => typeof key === 'string') : [],
        Array.isArray(reads) ? reads.filter(isStructuredAttentionRead) : []
      )
      return {
        dismissed: retireAnnouncements(
          [...retired.values()],
          paneKeys?.filter((key) => typeof key === 'string')
        )
      }
    }
  )

  const deliveryService = createNotificationDeliveryService({
    ...(typeof app?.getPath === 'function'
      ? { desktopDigestPath: join(app.getPath('userData'), 'desktop-notification-digests.json') }
      : {}),
    readPolicyScope: (request) => {
      const scope = resolveNotificationPolicyScope(
        store,
        request.worktreeId,
        request.notificationScope
      )
      const matches = agentHookServer
        .getEnrichedStatusSnapshot()
        .filter((row) => row.paneKey === request.paneKey && row.worktreeId === request.worktreeId)
      const row = matches.length === 1 ? matches[0] : undefined
      return row && request.surface !== 'agent-session'
        ? {
            ...scope,
            sessionId: row.providerSession?.id ?? row.paneKey,
            sessionGeneration: agentHookGeneration(row)
          }
        : scope
    },
    confirmStopPoint: (request) =>
      confirmNotificationRequest(request, () => agentHookServer.getEnrichedStatusSnapshot()),
    confirmDigestRelevant: (request) =>
      runtime
        ? confirmNotificationDigestRelevance(runtime, {
            ...request,
            type: 'notification',
            title: '',
            body: ''
          })
        : confirmNotificationRequest(request, () => agentHookServer.getEnrichedStatusSnapshot()),
    readNotificationSettings: () => store.getSettings().notifications,
    findActiveWindow: () =>
      BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null,
    isWindowVisible: isMainWindowVisible,
    setTrayAttention,
    isNotificationSupported: () => Notification.isSupported(),
    dispatchMobileNotification: runtime
      ? (payload) => runtime.dispatchMobileNotification(payload)
      : null,
    readAuthorizationStatus: readNotificationAuthorizationStatus,
    recordDeliveryOutcome: recordNotificationDeliveryOutcome,
    deliverNative: deliverNativeNotification,
    platform: process.platform,
    now: () => Date.now(),
    wasRead: announced.wasRead,
    repliesInSlack: (sessionId) => sessionRepliesInSlack(store, sessionId),
    reserveNative: (request) => {
      if (!request.notificationId || (!request.paneKey && !request.worktreeId)) {
        return undefined
      }
      const reservation = announced.reserveNative(
        request.paneKey ?? `worktree:${request.worktreeId}`,
        request.notificationId,
        request.structuredOrigin,
        request
      )
      discardEvictedAnnouncements(reservation.evicted)
      return reservation
    },
    recordAnnounced: (request) => {
      if (request.notificationId && (request.paneKey || request.worktreeId)) {
        if (announced.wasRead(request)) {
          retireAnnouncements([
            {
              id: request.notificationId,
              origin: request.structuredOrigin,
              paneKey: request.paneKey
            }
          ])
          return
        }
        discardEvictedAnnouncements(
          announced.record(
            request.paneKey ?? `worktree:${request.worktreeId}`,
            request.notificationId,
            request.structuredOrigin,
            request
          )
        )
      }
    }
  })

  currentDeliveryService = deliveryService

  // A cleared remote prompt must also retire alerts forwarded to this desktop's phones.
  ipcMain.removeHandler('notifications:settleStructuredPrompts')
  ipcMain.handle(
    'notifications:settleStructuredPrompts',
    (
      _event,
      scope: unknown,
      sessionId: unknown,
      executionHost?: NotificationDispatchRequest['executionHost']
    ): void => {
      if (isAgentSessionExecutionLocation(scope) && typeof sessionId === 'string' && sessionId) {
        runtime?.reconcileStructuredPromptAttention({
          scope,
          sessionId,
          pendingPromptIds: [],
          executionHost
        })
      }
    }
  )

  ipcMain.removeHandler('notifications:dispatch')
  ipcMain.handle(
    'notifications:dispatch',
    (
      _event,
      args: NotificationDispatchRequest
    ): NotificationDispatchResult | Promise<NotificationDispatchResult> =>
      deliveryService.dispatch(args)
  )

  registerNotificationSoundHandlers(store)
}
