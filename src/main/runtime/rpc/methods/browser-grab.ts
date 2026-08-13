import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { BrowserTarget, requiredString } from '../schemas'

const GrabSetMode = BrowserTarget.extend({ enabled: z.boolean() })
const GrabAwaitSelection = BrowserTarget.extend({
  opId: requiredString('Missing required opId')
})
const GrabCaptureScreenshot = BrowserTarget.extend({
  rect: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative()
  })
})

export const BROWSER_GRAB_METHODS: RpcMethod[] = [
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
