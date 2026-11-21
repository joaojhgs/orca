import { z } from 'zod'

export const CdpBrowserParams = z.object({ browserId: z.string().min(1).max(1500) }).strict()
export const CdpControlParams = CdpBrowserParams.extend({ humanControl: z.boolean() })
export const CdpTargetsParams = z.object({}).strict()
export type CdpBrowserTarget = {
  id: string
  label: string
  desktopId: string
  executionHostId: string
  humanControl: boolean
}
