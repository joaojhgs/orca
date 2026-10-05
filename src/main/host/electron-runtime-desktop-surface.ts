import { BrowserWindow, ipcMain, Notification, powerMonitor } from 'electron'
import { readDesktopAwayState } from '../notifications/desktop-away-state'
import type { RuntimeDesktopSurface } from '../runtime/runtime-desktop-surface'
import { mainProcessState } from '../startup/main-process-state'

/** The desktop implementation of the runtime's optional desktop facilities. */
export const electronRuntimeDesktopSurface: RuntimeDesktopSurface = {
  isAwayForMobileNotifications: () =>
    readDesktopAwayState(
      powerMonitor,
      mainProcessState.isServeMode &&
        (!mainProcessState.mainWindow || mainProcessState.mainWindow.isDestroyed())
    ),
  showNotification: ({ title, body }) => {
    if (!Notification.isSupported()) {
      return false
    }
    new Notification({ title, body }).show()
    return true
  },
  findWindowById: (id) => BrowserWindow.fromId(id),
  onIpc: (channel, listener) => {
    ipcMain.on(channel, listener as Parameters<typeof ipcMain.on>[1])
  },
  removeIpcListener: (channel, listener) => {
    ipcMain.removeListener(channel, listener as Parameters<typeof ipcMain.removeListener>[1])
  }
}
