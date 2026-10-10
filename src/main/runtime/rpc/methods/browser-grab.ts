import { defineMethod } from '../core'
import { BrowserTarget } from '../../../../shared/rpc-contract/rpc-param-primitives'
import {
  GrabSetMode,
  GrabAwaitSelection,
  GrabCaptureScreenshot
} from '../../../../shared/rpc-contract/browser-grab-params'

export const BROWSER_GRAB_METHODS = [
  defineMethod({
    name: 'browser.grab.setMode',
    permission: 'workspace',
    params: GrabSetMode,
    handler: async (params, { runtime }) => runtime.browserSetGrabMode(params)
  }),
  defineMethod({
    name: 'browser.grab.awaitSelection',
    permission: 'workspace',
    params: GrabAwaitSelection,
    handler: async (params, { runtime }) => runtime.browserAwaitGrabSelection(params)
  }),
  defineMethod({
    name: 'browser.grab.cancel',
    permission: 'workspace',
    params: BrowserTarget,
    handler: async (params, { runtime }) => runtime.browserCancelGrab(params)
  }),
  defineMethod({
    name: 'browser.grab.captureScreenshot',
    permission: 'workspace',
    params: GrabCaptureScreenshot,
    handler: async (params, { runtime }) => runtime.browserCaptureSelectionScreenshot(params)
  })
]
