import { defineMethod } from '../core'
import {
  GrabAwaitSelection,
  GrabCaptureScreenshot
} from '../../../../shared/rpc-contract/browser-grab-params'

export const BROWSER_GRAB_COMPAT_METHODS = [
  defineMethod({
    name: 'browser.grab.awaitSelection',
    permission: 'workspace',
    params: GrabAwaitSelection,
    handler: async (params, { runtime, signal }) => runtime.browserGrabAwait(params, signal)
  }),
  defineMethod({
    name: 'browser.grab.captureScreenshot',
    permission: 'workspace',
    params: GrabCaptureScreenshot,
    handler: async (params, { runtime }) => runtime.browserGrabCaptureSelection(params)
  })
]
