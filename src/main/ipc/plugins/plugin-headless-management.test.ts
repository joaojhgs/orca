import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { PluginService } from '../../plugins/plugin-service'
import { PluginMarketplaceStore } from '../../plugins/catalog/plugin-marketplace-store'
import { PluginMarketplaceService } from '../../plugins/catalog/plugin-marketplace-service'
import { PluginMarketplaceInstaller } from '../../plugins/catalog/plugin-marketplace-installer'
import {
  registerPluginManagementHandler,
  invokePluginManagement
} from '../../plugins/management/plugin-management-handlers'
import { registerPluginManagementHandlers } from './plugins'
import { registerPluginMarketplaceManagementHandlers } from './plugin-marketplaces'

vi.mock('electron', () => ({
  ipcMain: {
    handle: () => {
      throw new Error('Headless registration must not require desktop IPC')
    }
  }
}))
vi.mock('../../plugins/panels/guest-isolation/plugin-frame-guest-sessions', () => ({
  bindPluginFrameGuests: () => {},
  clearPluginFrameStorage: async () => {}
}))

it('serves stored plugin catalogs and manifests without registering desktop IPC', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-headless-plugin-management-'))
  const service = new PluginService({
    userDataPath: root,
    hostVersion: '2.0.0',
    isPluginSystemEnabled: () => false,
    getDisabledPlugins: () => [],
    getPluginConsents: () => ({}),
    getDevPluginPaths: () => []
  })
  try {
    await service.initialize()
    const store = new PluginMarketplaceStore(join(root, 'catalog'))
    await store.addSource({
      kind: 'git',
      url: 'https://github.com/example/plugins.git',
      ref: 'main'
    })
    const marketplace = new PluginMarketplaceService({
      pluginsDataDir: join(root, 'catalog'),
      store
    })
    const installer = new PluginMarketplaceInstaller({
      marketplace,
      userDataPath: root,
      hostVersion: '2.0.0',
      revokeConsent: async () => {}
    })
    registerPluginManagementHandlers(service, registerPluginManagementHandler)
    registerPluginMarketplaceManagementHandlers(
      service,
      { marketplace, installer },
      () => ({ pluginSystemEnabled: false }),
      async () => {},
      registerPluginManagementHandler
    )
    expect(await invokePluginManagement('listMarketplaces')).toMatchObject([
      { source: { url: 'https://github.com/example/plugins.git' } }
    ])
    expect(
      await invokePluginManagement('getInstalledManifest', { pluginKey: 'example.missing' })
    ).toBeNull()
    await expect(invokePluginManagement('getSettings', { pluginKey: 'invalid' })).rejects.toThrow()
  } finally {
    await service.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
