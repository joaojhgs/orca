import { defineMethod } from '../../core'
import {
  PluginPanelImageParams,
  PluginPanelStateParams
} from '../../../../../shared/rpc-contract/plugins/plugins-params'
import { getPluginsDataDir } from '../../../../plugins/discovery/plugin-discovery'
import { handlePluginPanelStateRequest } from '../../../../plugins/panels/panel-lifetime/plugin-panel-state'
import { readPluginPanelImage } from '../../../../plugins/panels/panel-lifetime/plugin-panel-image'
import { requirePluginService } from './plugins'
import { rpcPanelOwner } from './plugin-frame-owner'

export const PLUGIN_PANEL_DATA_METHODS = [
  defineMethod({
    name: 'plugins.panelState',
    permission: 'host-admin',
    params: PluginPanelStateParams,
    handler: async (params, context) => {
      const service = requirePluginService()
      await service.whenReady()
      return handlePluginPanelStateRequest(
        {
          pluginsDataDir: getPluginsDataDir(service.options.userDataPath),
          resolveComponentsPanel: (token) =>
            service.panels.componentsPanelPlugin(rpcPanelOwner(context), token)
        },
        params
      )
    }
  }),
  defineMethod({
    name: 'plugins.panelImage',
    permission: 'host-admin',
    params: PluginPanelImageParams,
    handler: async (params, context) => {
      const service = requirePluginService()
      await service.whenReady()
      const image = await readPluginPanelImage(
        {
          resolveComponentsPanelRoot: (token) =>
            service.panels.componentsPanelRoot(rpcPanelOwner(context), token)
        },
        params
      )
      return image
        ? {
            contentType: image.contentType,
            dataBase64: Buffer.from(image.bytes).toString('base64')
          }
        : null
    }
  })
]
