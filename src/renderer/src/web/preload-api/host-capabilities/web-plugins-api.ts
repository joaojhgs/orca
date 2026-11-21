import { createWebPluginStatusApi } from './web-plugin-status-api'
import type { PluginsApi } from '../../../../../preload/api/plugins/plugin-host-api'
import type { PluginManagementMethod } from '../../../../../shared/plugins/plugin-management-contract'
import type { PluginHostListEntry } from '../../../../../shared/plugins/plugin-list-entry'
import type { PluginChangeEvent } from '../../../../../shared/plugins/events/plugin-change-event'
import { unwrapRuntimeRpcResult } from '../../../runtime/rpc/calls/runtime-rpc-result'
import {
  callRuntimeResult,
  callEnvironmentEnvelope,
  assertEnvironmentPairing
} from '../../runtime/client/web-runtime-calls'
import {
  getClientForEnvironment,
  requireActiveEnvironment,
  requireActiveEnvironmentOrNull
} from '../../runtime/client/web-runtime-session'
import { noopUnsubscribe } from '../web-storage'

function manage<Key extends PluginManagementMethod>(
  method: Key,
  args?: unknown
): Promise<Awaited<ReturnType<NonNullable<PluginsApi[Key]>>>> {
  return callRuntimeResult('plugins.management', { method, args }, 120_000)
}

async function consent(args: Parameters<PluginsApi['consent']>[0]): Promise<PluginHostListEntry[]> {
  const owner = requireActiveEnvironment()
  const response = await callEnvironmentEnvelope<PluginHostListEntry[]>(
    owner.id,
    'plugins.consent',
    args
  )
  if (
    !response.ok &&
    response.error.code === 'approval_required' &&
    args.decision === 'approve' &&
    args.reviewedFingerprint
  ) {
    const data = response.error.data
    if (
      data &&
      typeof data === 'object' &&
      'approvalFingerprint' in data &&
      typeof data.approvalFingerprint === 'string' &&
      'pluginKey' in data &&
      data.pluginKey === args.pluginKey
    ) {
      assertEnvironmentPairing(owner.id, owner.pairingRevision ?? owner.createdAt)
      // The user's review stays bound to the same host and content through the audited approval path.
      return unwrapRuntimeRpcResult(
        await callEnvironmentEnvelope<PluginHostListEntry[]>(owner.id, 'plugins.consent', {
          ...args,
          approvalFingerprint: data.approvalFingerprint
        })
      )
    }
  }
  return unwrapRuntimeRpcResult(response)
}

function subscribePanelPush(sessionToken: string, listener: (push: unknown) => void): () => void {
  const owner = requireActiveEnvironment()
  const revision = owner.pairingRevision ?? owner.createdAt
  let closed = false
  let subscription: { unsubscribe: () => void } | undefined
  void getClientForEnvironment(owner)
    .subscribe(
      'plugins.subscribePanelPush',
      { sessionToken },
      {
        onResponse: (response) => {
          const current = requireActiveEnvironmentOrNull()
          if (
            closed ||
            current?.id !== owner.id ||
            (current.pairingRevision ?? current.createdAt) !== revision ||
            !response.ok
          ) {
            return
          }
          const result: unknown = response.result
          if (
            result &&
            typeof result === 'object' &&
            'type' in result &&
            result.type === 'push' &&
            'push' in result
          ) {
            listener(result.push)
          }
        }
      },
      {
        assertCurrent: () => {
          assertEnvironmentPairing(owner.id, revision)
          if (requireActiveEnvironmentOrNull()?.id !== owner.id) {
            throw new Error('The active Orca server changed')
          }
        },
        buildUnsubscribe: () => ({
          method: 'plugins.unsubscribePanelPush',
          params: { sessionToken }
        })
      }
    )
    .then((handle) => {
      if (closed) {
        handle.unsubscribe()
      } else {
        subscription = handle
      }
    })
    .catch(() => undefined)
  return () => {
    closed = true
    subscription?.unsubscribe()
  }
}

function onChanged(callback: (event: PluginChangeEvent) => void): () => void {
  const owner = requireActiveEnvironmentOrNull()
  if (!owner) {
    return noopUnsubscribe
  }
  let closed = false
  let subscription: { unsubscribe: () => void } | undefined
  void getClientForEnvironment(owner)
    .subscribe('plugins.subscribe', null, {
      onResponse: (response) => {
        if (closed || requireActiveEnvironmentOrNull()?.id !== owner.id || !response.ok) {
          return
        }
        const result: unknown = response.result
        if (
          result &&
          typeof result === 'object' &&
          'type' in result &&
          result.type === 'changed' &&
          'event' in result
        ) {
          const event = result.event
          if (
            event &&
            typeof event === 'object' &&
            'contentPacksChanged' in event &&
            typeof event.contentPacksChanged === 'boolean'
          ) {
            callback({ contentPacksChanged: event.contentPacksChanged })
          }
        }
      }
    })
    .then((handle) => {
      if (closed) {
        handle.unsubscribe()
      } else {
        subscription = handle
      }
    })
    .catch(() => undefined)
  return () => {
    closed = true
    subscription?.unsubscribe()
  }
}

export function createWebPluginsApi(): Pick<
  PluginsApi,
  | PluginManagementMethod
  | 'statusBarState'
  | 'onStatusBarChanged'
  | 'panelState'
  | 'panelImage'
  | 'readPanelEntry'
  | 'readCustomEditorEntry'
  | 'readNewFileTemplate'
  | 'panelAction'
  | 'invokeCommand'
  | 'subscribePanelPush'
  | 'list'
  | 'consent'
  | 'setEnabled'
  | 'remove'
  | 'getLogs'
  | 'refresh'
  | 'onChanged'
  | 'takeUpdateReviewNotices'
  | 'onInstallCountsChanged'
  | 'onAutoUpdateChanged'
> {
  return {
    ...createWebPluginStatusApi(),
    list: () => callRuntimeResult('plugins.list'),
    panelState: (args) => callRuntimeResult('plugins.panelState', args),
    panelImage: async (args) => {
      const image = await callRuntimeResult<{ contentType: string; dataBase64: string } | null>(
        'plugins.panelImage',
        args
      )
      return image
        ? {
            contentType: image.contentType,
            bytes: Uint8Array.from(atob(image.dataBase64), (char) => char.charCodeAt(0))
          }
        : null
    },
    readPanelEntry: (args) => callRuntimeResult('plugins.readPanelEntry', args),
    readCustomEditorEntry: (args) => callRuntimeResult('plugins.readCustomEditorEntry', args),
    readNewFileTemplate: (args) => callRuntimeResult('plugins.readNewFileTemplate', args),
    invokeCommand: (args) => callRuntimeResult('plugins.invokeCommand', args),
    panelAction: async (args) =>
      (
        await callRuntimeResult<{ outcome: Awaited<ReturnType<PluginsApi['panelAction']>> }>(
          'plugins.panelAction',
          args
        )
      ).outcome,
    subscribePanelPush,

    consent,
    setEnabled: (args) => callRuntimeResult('plugins.setEnabled', args),
    remove: async (args) => {
      await callRuntimeResult('plugins.uninstall', args)
      return callRuntimeResult('plugins.list')
    },
    getLogs: async (args) =>
      (
        await callRuntimeResult<{ lines: Awaited<ReturnType<PluginsApi['getLogs']>> }>(
          'plugins.getLogs',
          args
        )
      ).lines,
    refresh: () => callRuntimeResult('plugins.refresh'),
    getInstalledManifest: (args) => manage('getInstalledManifest', args),
    listLanguagePacks: () => manage('listLanguagePacks'),
    listThemes: () => manage('listThemes'),
    listTerminalThemes: () => manage('listTerminalThemes'),
    listIconThemes: () => manage('listIconThemes'),
    loadIconTheme: (id) => manage('loadIconTheme', id),
    listSyntaxes: () => manage('listSyntaxes'),
    loadSyntax: (id) => manage('loadSyntax', id),
    resolveGitSource: (args) => manage('resolveGitSource', args),
    install: (args) => manage('install', args),
    listMarketplaces: (args) => manage('listMarketplaces', args),
    addMarketplace: (args) => manage('addMarketplace', args),
    removeMarketplace: (args) => manage('removeMarketplace', args),
    refreshMarketplaces: (args) => manage('refreshMarketplaces', args),
    listMarketplacePlugins: (args) => manage('listMarketplacePlugins', args),
    previewMarketplacePlugin: (args) => manage('previewMarketplacePlugin', args),
    installMarketplacePlugin: (args) => manage('installMarketplacePlugin', args),
    previewMarketplaceUpdate: (args) => manage('previewMarketplaceUpdate', args),
    rollbackMarketplacePlugin: (args) => manage('rollbackMarketplacePlugin', args),
    getRollbackVersion: (args) => manage('getRollbackVersion', args),
    getSettings: (args) => manage('getSettings', args),
    setSetting: (args) => manage('setSetting', args),
    getAutoUpdateState: () => manage('getAutoUpdateState'),
    getInstallCounts: () => manage('getInstallCounts'),
    // Reading this queue would consume notifications intended for the desktop owner.
    takeUpdateReviewNotices: () => Promise.resolve([]),
    onChanged,
    onInstallCountsChanged: (callback) => onChanged(() => callback()),
    onAutoUpdateChanged: (callback) =>
      onChanged(() => {
        void manage('getAutoUpdateState')
          .then((state) => callback({ state, updated: [] }))
          .catch(() => undefined)
      })
  }
}
