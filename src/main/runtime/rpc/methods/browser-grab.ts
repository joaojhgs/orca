import { defineMethod } from '../core'
import { BrowserTarget } from '../schemas'
import {
  GrabSetMode,
  GrabAwaitSelection,
  GrabCaptureScreenshot
} from '../../../../shared/rpc-contract/browser-grab-params'

export const BROWSER_GRAB_METHODS = [
  defineMethod({
    name: 'browser.grab.setMode',
    params: GrabSetMode,
    handler: async (params, { runtime }) => runtime.browserSetGrabMode(params)
  }),
  defineMethod({
    name: 'browser.grab.awaitSelection',
    params: GrabAwaitSelection,
    handler: async (params, { runtime }) => runtime.browserAwaitGrabSelection(params)
  }),
  defineMethod({
    name: 'browser.grab.cancel',
    params: BrowserTarget,
    handler: async (params, { runtime }) => runtime.browserCancelGrab(params)
  }),
  defineMethod({
    name: 'browser.grab.captureScreenshot',
    params: GrabCaptureScreenshot,
    handler: async (params, { runtime }) => runtime.browserCaptureSelectionScreenshot(params)
  })
]
