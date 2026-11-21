import type { PluginManagementMethod } from '../../../shared/plugins/plugin-management-contract'

type Handler = (args?: unknown) => unknown
const handlers = new Map<PluginManagementMethod, Handler>()

export function registerPluginManagementHandler(
  method: PluginManagementMethod,
  handler: Handler
): void {
  handlers.set(method, handler)
}

export function invokePluginManagement(method: PluginManagementMethod, args?: unknown): unknown {
  const handler = handlers.get(method)
  if (!handler) {
    throw new Error('Plugin management is unavailable on this Orca host.')
  }
  return handler(args)
}
