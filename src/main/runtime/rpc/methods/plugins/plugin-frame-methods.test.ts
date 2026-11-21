import { createServer } from 'node:http'
import { handleWebPluginFrameHttp } from '../../../../plugins/panels/web-frames/web-plugin-frame-http'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fingerprintPluginConsent } from '../../../../../shared/plugins/approval/plugin-consent-fingerprint'
import { pluginManifestSchema } from '../../../../../shared/plugins/manifest/plugin-manifest'
import { devFolderConsentIdentity } from '../../../../plugins/discovery/plugin-discovery'
import { PluginService } from '../../../../plugins/plugin-service'
import { eraseRpcMethods, type RpcContext } from '../../core'
import { PLUGIN_FRAME_METHODS } from './plugin-frame-methods'
import { setPluginServiceForRpc } from './plugins'

const roots: string[] = []
const services: PluginService[] = []

afterEach(async () => {
  setPluginServiceForRpc(null)
  vi.unstubAllEnvs()
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function setup(approved = true) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-frame-rpc-')))
  roots.push(root)
  const manifest = pluginManifestSchema.parse({
    manifestVersion: 1,
    id: 'frames',
    publisher: 'samples',
    name: 'Frames',
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    contributes: {
      panels: [{ id: 'agenda', title: 'Agenda', entry: 'panel.html' }],
      customEditors: [{ id: 'doc', title: 'Document', entry: 'editor.html', extensions: ['.docx'] }]
    }
  })
  await writeFile(join(root, 'orca-plugin.json'), JSON.stringify(manifest))
  await writeFile(join(root, 'panel.html'), '<p>Agenda content</p>')
  await writeFile(join(root, 'editor.html'), '<p>Document content</p>')
  await writeFile(join(root, 'module.mjs'), 'export const answer = 42')
  const consent = fingerprintPluginConsent(manifest, await devFolderConsentIdentity(root))
  const service = new PluginService({
    userDataPath: root,
    hostVersion: '1.4.0',
    isPluginSystemEnabled: () => true,
    getDisabledPlugins: () => [],
    getPluginConsents: (): Record<string, string> =>
      approved ? { 'samples.frames': consent } : {},
    getDevPluginPaths: () => [root]
  })
  services.push(service)
  await service.initialize()
  setPluginServiceForRpc(service)
  const cleanup = new Map<string, () => void>()
  const context: RpcContext = {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: frame RPC uses only these subscription ports.
    runtime: {
      registerSubscriptionCleanup: (id: string, stop: () => void) => cleanup.set(id, stop),
      cleanupSubscription: (id: string) => {
        const stop = cleanup.get(id)
        cleanup.delete(id)
        stop?.()
      }
    } as unknown as RpcContext['runtime'],
    connectionId: 'browser-one',
    signal: new AbortController().signal,
    caller: { kind: 'local-cli' }
  }
  return { service, context }
}

function method(name: string) {
  const found = eraseRpcMethods(PLUGIN_FRAME_METHODS).find((entry) => entry.name === name)
  if (!found) {
    throw new Error('missing frame method')
  }
  return found
}

async function openEditor(context: RpcContext) {
  const open = method('plugins.readCustomEditorEntry')
  if ('stream' in open) {
    throw new Error('expected unary method')
  }
  return open.handler({ pluginKey: 'samples.frames', editorId: 'doc' }, context)
}

describe('browser plugin frame RPC', () => {
  it('serves the approved editor and binds its token to the requesting connection', async () => {
    const { service, context } = await setup()
    const entry = await openEditor(context)
    expect(entry).toMatchObject({ html: expect.stringContaining('Document content') })
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('sessionToken' in entry) ||
      typeof entry.sessionToken !== 'string'
    ) {
      throw new Error('editor did not issue a session')
    }
    expect(service.panels.sessionCaller('runtime:browser-one', entry.sessionToken)).toMatchObject({
      pluginKey: 'samples.frames'
    })
    expect(service.panels.sessionCaller('runtime:browser-two', entry.sessionToken)).toBeNull()
  })
  it('serves browser assets only within the approved plugin origin and revokes them with the panel session', async () => {
    vi.stubEnv('ORCA_PLUGIN_FRAME_DOMAIN', 'plugins.example.test')
    vi.stubEnv('ORCA_PLUGIN_FRAME_PARENT_ORIGIN', 'https://orca.example.test')
    const { service, context } = await setup()
    const entry = await openEditor(context)
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('guest' in entry) ||
      !entry.guest ||
      typeof entry.guest !== 'object' ||
      !('url' in entry.guest) ||
      typeof entry.guest.url !== 'string'
    ) {
      throw new Error('missing browser frame')
    }
    const frame = new URL(entry.guest.url)
    const server = createServer((request, response) => {
      void handleWebPluginFrameHttp(request, response).then((handled) => {
        if (!handled) {
          response.writeHead(404)
          response.end()
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('missing HTTP address')
    }
    const base = `http://127.0.0.1:${address.port}`
    try {
      const document = await fetch(base + frame.pathname, { headers: { host: frame.hostname } })
      expect(document.status).toBe(200)
      expect(await document.text()).toContain('Document content')
      expect(document.headers.get('Content-Security-Policy')).toContain(
        'frame-ancestors https://orca.example.test'
      )
      const cookie = document.headers.get('set-cookie')?.split(';')[0] ?? ''
      expect(
        (await fetch(`${base}/module.mjs`, { headers: { host: frame.hostname } })).status
      ).toBe(404)
      const module = await fetch(`${base}/module.mjs`, {
        headers: { host: frame.hostname, cookie }
      })
      expect(module.status).toBe(200)
      expect(await module.text()).toContain('export const answer = 42')
      expect(
        (
          await fetch(`${base}/module.mjs`, {
            headers: { host: '0000000000000000.plugins.example.test', cookie }
          })
        ).status
      ).toBe(404)
      expect(
        (await fetch(`${base}/%2e%2e/package.json`, { headers: { host: frame.hostname, cookie } }))
          .status
      ).toBe(404)
      service.panels.revokeOwner('runtime:browser-one')
      expect(
        (await fetch(`${base}/module.mjs`, { headers: { host: frame.hostname, cookie } })).status
      ).toBe(404)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })

  it('does not serve an unapproved editor', async () => {
    const { context } = await setup(false)
    expect(await openEditor(context)).toBeNull()
  })
  it('delivers live pushes only to the owning connection and releases the channel on unsubscribe', async () => {
    const { service, context } = await setup()
    const entry = await service.panels.open('runtime:browser-one', 'samples.frames', 'agenda')
    if (!entry) {
      throw new Error('missing approved panel')
    }
    const stream = method('plugins.subscribePanelPush')
    const stop = method('plugins.unsubscribePanelPush')
    if (!('stream' in stream) || 'stream' in stop) {
      throw new Error('invalid method kind')
    }
    const params = { sessionToken: entry.sessionToken }
    await expect(
      stream.handler(params, { ...context, connectionId: 'browser-two' }, vi.fn())
    ).rejects.toThrow('invalid panel session')
    const emit = vi.fn()
    const pending = stream.handler(params, context, emit)
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith({ type: 'ready' }))
    service.panelBridge.onWorkerPost('samples.frames', { event: 'updated', payload: { count: 1 } })
    expect(emit).toHaveBeenLastCalledWith({
      type: 'push',
      push: { kind: 'message', event: 'updated', payload: { count: 1 } }
    })
    await stop.handler(params, context)
    await pending
    emit.mockClear()
    service.panelBridge.onWorkerPost('samples.frames', { event: 'updated', payload: null })
    expect(emit).not.toHaveBeenCalled()
    expect(service.panels.sessionCaller('runtime:browser-one', entry.sessionToken)).not.toBeNull()
  })
})
