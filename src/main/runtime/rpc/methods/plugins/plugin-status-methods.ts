import { defineMethod, defineStreamingMethod } from '../../core'
import { requirePluginService } from './plugins'

let sequence = 0
export const PLUGIN_STATUS_METHODS = [
  defineMethod({
    name: 'plugins.statusBarState',
    permission: 'host-admin',
    params: null,
    handler: () => requirePluginService().options.statusBar?.snapshot() ?? {}
  }),
  defineStreamingMethod({
    name: 'plugins.subscribeStatusBar',
    permission: 'host-admin',
    params: null,
    handler: async (_params, { runtime, connectionId, signal }, emit) => {
      if (signal?.aborted) {
        return
      }
      const state = requirePluginService().options.statusBar
      const stopped = Promise.withResolvers<void>()
      const unsubscribe = state?.onChanged((overrides) => emit({ overrides }))
      const id = `plugin-status-${connectionId ?? 'local'}-${++sequence}`
      const stop = () => runtime.cleanupSubscription(id)
      runtime.registerSubscriptionCleanup(
        id,
        () => {
          unsubscribe?.()
          stopped.resolve()
        },
        connectionId
      )
      signal?.addEventListener('abort', stop, { once: true })
      try {
        emit({ overrides: state?.snapshot() ?? {} })
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
