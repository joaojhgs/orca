import { RuntimeBrowserCommandsWithListLogicalBrowserTabs } from './runtime-browser-commands-list-logical-browser-tabs'
import { browserManager } from '../browser/browser-manager'
import type { BrowserCommandTargetParams } from './runtime-browser-commands-browser-command-target-params'
import type {
  BrowserGrabRect,
  BrowserGrabResult,
  BrowserSetGrabModeResult,
  BrowserCaptureSelectionScreenshotResult
} from '../../shared/browser-grab-types'

export class RuntimeBrowserCommands extends RuntimeBrowserCommandsWithListLogicalBrowserTabs {
  async browserSetGrabMode(
    params: { enabled: boolean } & BrowserCommandTargetParams
  ): Promise<BrowserSetGrabModeResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    const { browserPageId, webContents: guest } = this.resolveBrowserPageWebContents(
      target.worktreeId,
      target.browserPageId
    )
    const ok = await browserManager.setGrabMode(browserPageId, params.enabled, guest)
    return ok ? { ok: true } : { ok: false, reason: 'injection-failed' }
  }

  async browserAwaitGrabSelection(
    params: { opId: string } & BrowserCommandTargetParams
  ): Promise<BrowserGrabResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    const { browserPageId, webContents: guest } = this.resolveBrowserPageWebContents(
      target.worktreeId,
      target.browserPageId
    )
    return browserManager.awaitGrabSelection(browserPageId, params.opId, guest)
  }

  async browserCancelGrab(params: BrowserCommandTargetParams): Promise<{ ok: true }> {
    const target = await this.resolveBrowserCommandTarget(params)
    const { browserPageId } = this.resolveBrowserPageWebContents(
      target.worktreeId,
      target.browserPageId
    )
    browserManager.cancelGrabOp(browserPageId, 'user')
    return { ok: true }
  }

  async browserCaptureSelectionScreenshot(
    params: { rect: BrowserGrabRect } & BrowserCommandTargetParams
  ): Promise<BrowserCaptureSelectionScreenshotResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    const { browserPageId, webContents: guest } = this.resolveBrowserPageWebContents(
      target.worktreeId,
      target.browserPageId
    )
    const screenshot = await browserManager.captureSelectionScreenshot(
      browserPageId,
      params.rect,
      guest
    )
    return screenshot ? { ok: true, screenshot } : { ok: false, reason: 'capture-failed' }
  }
}
export type { BrowserCommandTargetParams } from './runtime-browser-commands-browser-command-target-params'
export type { RuntimeBrowserCommandHost } from './runtime-browser-commands-browser-command-target-params'
