import { defineMethod, defineStreamingMethod } from '../../core'
import {
  PluginPanelSubscribeParams,
  PluginReadPanelEntryParams,
  PluginReadCustomEditorEntryParams,
  PluginReadNewFileTemplateParams
} from '../../../../../shared/rpc-contract/plugins/plugins-params'
import { readApprovedPluginNewFileTemplate } from '../../../../plugins/contributions/plugin-new-file-template'
import {
  prepareWebPluginFrame,
  webPluginFrameDomain
} from '../../../../plugins/panels/web-frames/web-plugin-frame-tickets'
import { requirePluginService } from './plugins'
import { bindRpcPanelOwner, rpcPanelOwner } from './plugin-frame-owner'
import type { PluginFrameEntry } from '../../../../../shared/plugins/frames/plugin-frame-bridge'

export const PLUGIN_FRAME_METHODS = [
  defineMethod({
    name: 'plugins.readPanelEntry',
    permission: 'workspace',
    params: PluginReadPanelEntryParams,
    handler: async (params, context): Promise<PluginFrameEntry | null> => {
      const service = requirePluginService()
      await service.whenReady()
      const ownerKey = bindRpcPanelOwner(service, context)
      const entry = await service.panels.open(
        ownerKey,
        params.pluginKey,
        params.panelId,
        undefined,
        { shell: !webPluginFrameDomain() }
      )
      if (context.signal?.aborted) {
        service.panels.revokeOwner(ownerKey)
        return null
      }
      return prepareWebPluginFrame({
        service,
        ownerKey,
        entry,
        pluginKey: params.pluginKey,
        surface: 'panel',
        id: params.panelId,
        theme: params.theme
      })
    }
  }),

  defineMethod({
    name: 'plugins.readCustomEditorEntry',
    permission: 'workspace',
    params: PluginReadCustomEditorEntryParams,
    handler: async (params, context) => {
      const service = requirePluginService()
      await service.whenReady()
      const ownerKey = bindRpcPanelOwner(service, context)
      const entry = await service.panels.openCustomEditor(
        ownerKey,
        params.pluginKey,
        params.editorId,
        () => context.signal?.aborted !== true,
        { shell: !webPluginFrameDomain() }
      )
      return prepareWebPluginFrame({
        service,
        ownerKey,
        entry,
        pluginKey: params.pluginKey,
        surface: 'editor',
        id: params.editorId,
        theme: params.theme
      })
    }
  }),
  defineMethod({
    name: 'plugins.readNewFileTemplate',
    permission: 'workspace',
    params: PluginReadNewFileTemplateParams,
    handler: async (params) => {
      const service = requirePluginService()
      await service.whenReady()
      return readApprovedPluginNewFileTemplate(service, params.pluginKey, params.newFileId)
    }
  }),
  defineMethod({
    name: 'plugins.unsubscribePanelPush',
    permission: 'host-admin',
    params: PluginPanelSubscribeParams,
    handler: (params, context) => {
      const session = requirePluginService().panels.sessionCaller(
        rpcPanelOwner(context),
        params.sessionToken
      )
      if (session) {
        context.runtime.cleanupSubscription(
          `plugin-panel-${context.connectionId ?? 'local'}-${session.caller.id}`
        )
      }
      return { unsubscribed: true }
    }
  }),
  defineStreamingMethod({
    name: 'plugins.subscribePanelPush',
    permission: 'host-admin',
    params: PluginPanelSubscribeParams,
    handler: async (params, context, emit) => {
      const service = requirePluginService()
      await service.whenReady()
      if (context.signal?.aborted) {
        return
      }
      const session = service.panels.sessionCaller(rpcPanelOwner(context), params.sessionToken)
      if (!session) {
        throw new Error('invalid panel session')
      }
      const stopped = Promise.withResolvers<void>()
      const unsubscribe = service.panelBridge.open(session.caller, session.pluginKey, (push) =>
        emit({ type: 'push', push })
      )
      const subscriptionId = `plugin-panel-${context.connectionId ?? 'local'}-${session.caller.id}`
      const stop = () => context.runtime.cleanupSubscription(subscriptionId)
      context.runtime.registerSubscriptionCleanup(
        subscriptionId,
        () => {
          unsubscribe()
          stopped.resolve()
        },
        context.connectionId
      )
      context.signal?.addEventListener('abort', stop, { once: true })
      try {
        emit({ type: 'ready' })
        if (context.signal?.aborted) {
          stop()
        }
        await stopped.promise
      } finally {
        context.signal?.removeEventListener('abort', stop)
        stop()
      }
    }
  })
]
