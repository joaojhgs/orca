import type { PluginStatusBarOverrides } from '../../../../../shared/plugins/contributions/plugin-status-bar-state'
import { callRuntimeResult } from '../../runtime/client/web-runtime-calls'
import {
  getClientForEnvironment,
  requireActiveEnvironment,
  requireActiveEnvironmentOrNull
} from '../../runtime/client/web-runtime-session'

export function createWebPluginStatusApi() {
  return {
    statusBarState: (): Promise<PluginStatusBarOverrides> =>
      callRuntimeResult('plugins.statusBarState'),
    onStatusBarChanged: (callback: (overrides: PluginStatusBarOverrides) => void): (() => void) => {
      const owner = requireActiveEnvironment()
      let closed = false
      let handle: { unsubscribe: () => void } | undefined
      void getClientForEnvironment(owner)
        .subscribe('plugins.subscribeStatusBar', null, {
          onResponse: (response) => {
            const current = requireActiveEnvironmentOrNull()
            if (
              closed ||
              current?.id !== owner.id ||
              (current.pairingRevision ?? current.createdAt) !==
                (owner.pairingRevision ?? owner.createdAt) ||
              !response.ok
            ) {
              return
            }
            const result = response.result
            if (
              result &&
              typeof result === 'object' &&
              'overrides' in result &&
              result.overrides &&
              typeof result.overrides === 'object'
            ) {
              // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the paired runtime emits PluginStatusBarState snapshots.
              callback(result.overrides as PluginStatusBarOverrides)
            }
          }
        })
        .then((subscription) => {
          if (closed) {
            subscription.unsubscribe()
          } else {
            handle = subscription
          }
        })
        .catch(() => undefined)
      return () => {
        closed = true
        handle?.unsubscribe()
      }
    }
  }
}
