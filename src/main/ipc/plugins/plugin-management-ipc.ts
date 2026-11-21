import { ipcMain } from 'electron'
import type { PluginManagementMethod } from '../../../shared/plugins/plugin-management-contract'
import { registerPluginManagementHandler } from '../../plugins/management/plugin-management-handlers'

/** Reuse the same validated host operations for Electron IPC and paired browser settings. */
export function registerPluginManagementIpc(
  method: PluginManagementMethod,
  handler: (args?: unknown) => unknown
): void {
  registerPluginManagementHandler(method, handler)
  ipcMain.handle(`plugins:${method}`, (_event, args: unknown) => handler(args))
}
