import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installBrowserGlobals,
  writeStoredRuntimeEnvironment
} from '../../testing/web-preload-api-test-harness'

const call = vi.fn()

beforeEach(() => {
  vi.resetModules()
  call.mockReset()
  vi.doMock('../../runtime/client/web-runtime-client', () => ({
    WebRuntimeClient: class {
      call(method: string, params: unknown): Promise<unknown> {
        return call(method, params)
      }
      close(): void {}
    }
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('../../runtime/client/web-runtime-client')
})

async function api() {
  const globals = installBrowserGlobals('Linux')
  writeStoredRuntimeEnvironment(globals.storage, 'control')
  const { installWebPreloadApi } = await import('../../web-preload-api')
  installWebPreloadApi()
  return { plugins: globals.window.api.plugins }
}

function reply(result: unknown) {
  return { id: 'test', ok: true, result, _meta: { runtimeId: 'control' } }
}

describe('paired browser plugin frames', () => {
  it('loads panel and custom-editor documents from the paired runtime', async () => {
    const panel = { html: '<p>Calendar</p>', sessionToken: 'panel-session' }
    const editor = { html: '<p>Word Preview</p>', sessionToken: 'editor-session' }
    call.mockImplementation((method) =>
      Promise.resolve(reply(method === 'plugins.readPanelEntry' ? panel : editor))
    )
    const { plugins } = await api()
    await expect(
      plugins.readPanelEntry({ pluginKey: 'demo.calendar', panelId: 'agenda' })
    ).resolves.toEqual(panel)
    await expect(
      plugins.readCustomEditorEntry?.({ pluginKey: 'demo.word', editorId: 'docx' })
    ).resolves.toEqual(editor)
    expect(call).toHaveBeenCalledWith('plugins.readPanelEntry', {
      pluginKey: 'demo.calendar',
      panelId: 'agenda'
    })
    expect(call).toHaveBeenCalledWith('plugins.readCustomEditorEntry', {
      pluginKey: 'demo.word',
      editorId: 'docx'
    })
  })
  it('unwraps host-call outcomes instead of passing an unusable RPC wrapper to the plugin', async () => {
    call.mockResolvedValue(reply({ outcome: { ok: true, value: { connected: false } } }))
    const { plugins } = await api()
    await expect(
      plugins.panelAction({ sessionToken: 'session', action: 'plugin.request' })
    ).resolves.toEqual({ ok: true, value: { connected: false } })
    expect(call).toHaveBeenCalledWith('plugins.panelAction', {
      sessionToken: 'session',
      action: 'plugin.request'
    })
  })
  it('preserves denied plugin calls and transport errors', async () => {
    const { plugins } = await api()
    call.mockResolvedValue(
      reply({ outcome: { ok: false, code: 'capability_denied', error: 'denied' } })
    )
    await expect(
      plugins.panelAction({ sessionToken: 'session', action: 'storage.set' })
    ).resolves.toEqual({ ok: false, code: 'capability_denied', error: 'denied' })
    call.mockResolvedValue({
      id: 'test',
      ok: false,
      error: { code: 'unavailable', message: 'Host disconnected' }
    })
    await expect(
      plugins.readCustomEditorEntry?.({ pluginKey: 'demo.word', editorId: 'docx' })
    ).rejects.toThrow('Host disconnected')
  })
})
