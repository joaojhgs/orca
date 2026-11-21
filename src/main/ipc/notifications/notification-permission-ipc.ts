import { Notification, ipcMain } from 'electron'
import type { Store } from '../../persistence/loading-store/store'
import type {
  NotificationDeliveryProbeResult,
  NotificationPermissionStatusResult
} from '../../../shared/notifications/notification-settings-types'
import { readNotificationAuthorizationStatus } from './notification-authorization-status'
import { openNotificationSystemSettings } from './notification-system-settings-link'
import {
  getLastObservedDeliveryOutcome,
  hasTriggeredPermissionDialogThisSession,
  probeNotificationDelivery,
  recordNotificationDeliveryOutcome,
  resetNotificationPermissionEvidence
} from './notification-permission-probe'

export function registerNotificationPermissionHandlers(
  store: Pick<Store, 'getUI' | 'updateUI'>
): void {
  resetNotificationPermissionEvidence()

  ipcMain.removeHandler('notifications:openSystemSettings')
  ipcMain.removeHandler('notifications:getPermissionStatus')
  ipcMain.removeHandler('notifications:probeDelivery')
  ipcMain.handle('notifications:openSystemSettings', (): void => {
    openNotificationSystemSettings()
  })

  // Keep the legacy status surface observational; native authorization is read by onboarding below.
  const getPermissionStatus = (): NotificationPermissionStatusResult => ({
    supported: Notification.isSupported(),
    platform: process.platform,
    requested: store.getUI().notificationPermissionRequested === true
  })

  ipcMain.handle('notifications:getPermissionStatus', getPermissionStatus)
  ipcMain.handle(
    'notifications:probeDelivery',
    async (_event, args?: { force?: boolean }): Promise<NotificationDeliveryProbeResult> => {
      // First-use permission onboarding is macOS-only.
      if (process.platform !== 'darwin' || !Notification.isSupported()) {
        return { state: 'unsupported', authoritative: false }
      }
      // Record prompting intent so startup registration cannot trigger a second prompt.
      if (store.getUI().notificationPermissionRequested !== true) {
        store.updateUI({ notificationPermissionRequested: true })
      }
      // Prefer silent native reads so System Settings changes are visible without probe banners.
      const authorization = await readNotificationAuthorizationStatus()
      if (authorization === 'authorized') {
        recordNotificationDeliveryOutcome('delivered')
        return { state: 'delivered', authoritative: true }
      }
      if (authorization === 'denied') {
        recordNotificationDeliveryOutcome('failed')
        return { state: 'blocked', authoritative: true }
      }
      if (authorization === 'not-determined') {
        // Trigger the first-use presenter once, then report awaiting-decision.
        if (!hasTriggeredPermissionDialogThisSession()) {
          void probeNotificationDelivery()
        }
        return { state: 'awaiting-decision', authoritative: true }
      }
      // Without native evidence, cache scheduling probes within the session to avoid repeat banners.
      const lastObservedDeliveryOutcome = getLastObservedDeliveryOutcome()
      if (!args?.force && lastObservedDeliveryOutcome !== null) {
        return {
          state: lastObservedDeliveryOutcome === 'delivered' ? 'delivered' : 'blocked',
          authoritative: false
        }
      }
      return probeNotificationDelivery()
    }
  )
}
