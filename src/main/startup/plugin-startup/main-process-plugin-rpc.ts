import type { Store } from '../../persistence/loading-store/store'
import {
  applyPluginConsent,
  applyPluginEnablement
} from '../../plugins/activation/plugin-enablement'
import type { DesktopCore } from '../../core-desktop/desktop-core'
import { registerPluginManagementHandlers } from '../../ipc/plugins/plugins'
import {
  registerPluginMarketplaceManagementHandlers,
  type PluginMarketplaceHandlerServices
} from '../../ipc/plugins/plugin-marketplaces'
import { registerPluginManagementHandler } from '../../plugins/management/plugin-management-handlers'
import { clearPluginFrameStorage } from '../../plugins/panels/guest-isolation/plugin-frame-guest-sessions'
import { openPluginFrameGuestDevTools } from '../../plugins/panels/guest-isolation/plugin-frame-guest-diagnostics'
import { setPluginServiceForRpc } from '../../runtime/rpc/methods/plugins/plugins'
import { setPluginInstallServicesForRpc } from '../../runtime/rpc/methods/plugins/plugin-install-methods'

/** Headless RPC resolves these too; consent shares the desktop hash-keyed write path. */
export function bindPluginRpcServices(
  store: Store,
  core: Pick<
    DesktopCore,
    | 'pluginService'
    | 'pluginMarketplaceService'
    | 'pluginMarketplaceInstaller'
    | 'pluginAutoUpdater'
    | 'pluginUpdateReviewNotices'
    | 'pluginInstallStatsService'
  >
): void {
  const {
    pluginService,
    pluginMarketplaceService: marketplace,
    pluginMarketplaceInstaller: installer
  } = core
  if (!pluginService || !marketplace || !installer) {
    throw new Error('Plugin services must be initialized before RPC registration')
  }
  const catalogs: PluginMarketplaceHandlerServices = {
    marketplace,
    installer,
    autoUpdater: core.pluginAutoUpdater ?? undefined,
    reviewNotices: core.pluginUpdateReviewNotices ?? undefined,
    installStats: core.pluginInstallStatsService ?? undefined
  }
  registerPluginManagementHandlers(pluginService, registerPluginManagementHandler)
  registerPluginMarketplaceManagementHandlers(
    pluginService,
    catalogs,
    () => store.getSettings(),
    (pluginKey, reviewedFingerprint) =>
      applyPluginConsent({
        store,
        pluginService,
        pluginKey,
        reviewedFingerprint,
        decision: 'approve'
      }),
    registerPluginManagementHandler
  )
  setPluginServiceForRpc(pluginService, {
    applyConsent: (request) => applyPluginConsent({ store, pluginService, ...request }),
    applyEnablement: (pluginKey, enabled) =>
      applyPluginEnablement({ store, pluginService, pluginKey, enabled }),
    setPluginSystemEnabled: (pluginSystemEnabled) =>
      store.updateSettings({ pluginSystemEnabled }, { notifyListeners: true }),
    setDevPluginPaths: (devPluginPaths) =>
      store.updateSettings({ devPluginPaths }, { notifyListeners: true }),
    openFrameDevTools: openPluginFrameGuestDevTools
  })
  setPluginInstallServicesForRpc({
    pluginService,
    catalogs,
    applyConsent: (request) => applyPluginConsent({ store, pluginService, ...request }),
    store,
    afterUninstall: clearPluginFrameStorage
  })
}
