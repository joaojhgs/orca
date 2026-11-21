import type {
  MethodHandler,
  RequestContext
} from '../wsl-guest/transport/connection/dispatcher-contract'
import {
  admitPluginPanelCall,
  createPluginPanelCallAdmission,
  type PluginPanelCallAdmission
} from '../shared/plugins/frames/plugin-panel-call-admission'
import {
  executePluginHostCallRequest,
  type ResolvePluginHostCallPolicy
} from '../main/plugins/workers/host-api/plugin-host-call-adapter'

export const RELAY_PLUGIN_PANEL_HOST_CALL_METHOD = 'plugins.hostCall.panel'
export const RELAY_PLUGIN_WORKER_HOST_CALL_METHOD = 'plugins.hostCall.worker'

export type RelayPluginHostCallDispatcher = {
  onRequest(method: string, handler: MethodHandler): void
}

export type ResolveRelayPluginHostCallIdentity = (
  context: RequestContext
) => string | null | Promise<string | null>

/** Relay provisioning is deliberately out of scope here. Its connection-
 *  keyed resolver owns plugin identity, consent, services, and audit authority. */
export function registerRelayPluginHostCallHandlers(
  dispatcher: RelayPluginHostCallDispatcher,
  resolveIdentity: ResolveRelayPluginHostCallIdentity,
  resolvePolicy: ResolvePluginHostCallPolicy,
  options: { panelAdmission?: PluginPanelCallAdmission } = {}
): void {
  const panelAdmission = options.panelAdmission ?? createPluginPanelCallAdmission()
  const register = (registeredMethod: string, viaPanel: boolean): void => {
    dispatcher.onRequest(registeredMethod, async (params, context) => {
      let pluginKey: string | null
      try {
        pluginKey = await resolveIdentity(context)
      } catch {
        pluginKey = null
      }
      if (!pluginKey) {
        return {
          ok: false,
          code: 'unavailable',
          error: 'plugin host authority is not available'
        }
      }
      if (viaPanel) {
        const admissionRefusal = admitPluginPanelCall(panelAdmission, pluginKey, params)
        if (admissionRefusal) {
          return admissionRefusal
        }
      }
      return executePluginHostCallRequest({
        pluginKey,
        request: params,
        surface: viaPanel ? 'panel' : 'worker',
        resolvePolicy
      })
    })
  }
  // Why: transport authority is fixed by the registered RPC method; callers
  // cannot promote a panel call to the wider worker method set in params.
  register(RELAY_PLUGIN_PANEL_HOST_CALL_METHOD, true)
  register(RELAY_PLUGIN_WORKER_HOST_CALL_METHOD, false)
}
