import { defineMethod, defineStreamingMethod } from '../../core'
import { PluginManagementParams } from '../../../../../shared/plugins/plugin-management-contract'
import { invokePluginManagement } from '../../../../plugins/management/plugin-management-handlers'
import { requirePluginService } from './plugins'

let sequence = 0

export const PLUGIN_MANAGEMENT_METHODS = [
  defineMethod({
    name: 'plugins.management',
    permission: 'host-admin',
    params: PluginManagementParams,
    handler: (params) => invokePluginManagement(params.method, params.args)
  }),
  defineStreamingMethod({
    name: 'plugins.subscribe',
    permission: 'workspace',
    params: null,
    handler: async (_params, { signal, runtime, connectionId }, emit) => {
      if (signal?.aborted) {
        return
      }
      const stopped = Promise.withResolvers<void>()
      const unsubscribe = requirePluginService().onChanged((event) =>
        emit({ type: 'changed', event })
      )
      const subscriptionId = `plugins-${connectionId ?? 'local'}-${++sequence}`
      const stop = () => runtime.cleanupSubscription(subscriptionId)
      runtime.registerSubscriptionCleanup(
        subscriptionId,
        () => {
          unsubscribe()
          stopped.resolve()
        },
        connectionId
      )
      signal?.addEventListener('abort', stop, { once: true })
      try {
        emit({ type: 'ready' })
        if (signal?.aborted) {
          stop()
        }
        await stopped.promise
      } finally {
        signal?.removeEventListener('abort', stop)
        stop()
      }
    }
  })
]
