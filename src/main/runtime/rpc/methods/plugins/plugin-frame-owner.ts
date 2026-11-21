import type { RpcContext } from '../../core'
import type { PluginService } from '../../../../plugins/plugin-service'

export function rpcPanelOwner(context: RpcContext): string {
  // Bind bearer sessions to individual paired connections, even for sibling sockets of one device.
  return `runtime:${context.connectionId ?? context.clientId ?? 'local'}`
}

export function bindRpcPanelOwner(service: PluginService, context: RpcContext): string {
  const ownerKey = rpcPanelOwner(context)
  service.panels.bindOwnerSignal(ownerKey, context.signal)
  return ownerKey
}
