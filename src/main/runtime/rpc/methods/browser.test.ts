import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { BROWSER_GRAB_METHODS } from './browser/browser-grab'
import { BROWSER_GRAB_COMPAT_METHODS } from './browser-grab'

const makeRequest = (method: string, params: unknown) => ({
  id: 'test',
  method,
  params,
  authToken: ''
})

describe('browser Design Mode compatibility', () => {
  it('routes remote Design Mode operations to the browser host', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      browserGrabSetMode: vi.fn().mockResolvedValue({ ok: true }),
      browserGrabAwait: vi
        .fn()
        .mockResolvedValue({ opId: 'grab-1', kind: 'cancelled', reason: 'user' }),
      browserGrabCancel: vi.fn().mockResolvedValue({ ok: true }),
      browserGrabCaptureSelection: vi
        .fn()
        .mockResolvedValue({ ok: false, reason: 'capture-failed' })
    }
    const dispatcher = new RpcDispatcher({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This dispatcher fixture supplies every runtime method exercised here.
      runtime: runtime as unknown as OrcaRuntimeService,
      methods: [...BROWSER_GRAB_METHODS, ...BROWSER_GRAB_COMPAT_METHODS]
    })
    const target = { worktree: 'id:wt-1', page: 'page-1' }
    await dispatcher.dispatch(makeRequest('browser.grab.setMode', { ...target, enabled: true }))
    await dispatcher.dispatch(
      makeRequest('browser.grab.awaitSelection', { ...target, opId: 'grab-1' })
    )
    await dispatcher.dispatch(makeRequest('browser.grab.cancel', target))
    const rect = { x: 1, y: 2, width: 30, height: 40 }
    await dispatcher.dispatch(makeRequest('browser.grab.captureScreenshot', { ...target, rect }))
    expect(runtime.browserGrabSetMode).toHaveBeenCalledWith({ ...target, enabled: true })
    expect(runtime.browserGrabAwait).toHaveBeenCalledWith({ ...target, opId: 'grab-1' }, undefined)
    expect(runtime.browserGrabCancel).toHaveBeenCalledWith(target)
    expect(runtime.browserGrabCaptureSelection).toHaveBeenCalledWith({ ...target, rect })
  })
})
