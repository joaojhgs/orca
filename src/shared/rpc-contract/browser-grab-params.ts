import { z } from 'zod'
import { BrowserTarget, requiredString } from './rpc-param-primitives'

export const GrabSetMode = BrowserTarget.extend({ enabled: z.boolean() })
export const GrabAwaitSelection = BrowserTarget.extend({
  opId: requiredString('Missing required opId')
})
export const GrabCaptureScreenshot = BrowserTarget.extend({
  rect: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative()
  })
})
export const BrowserWebProxyOpen = z.object({ url: z.string().min(1) }).strict()
