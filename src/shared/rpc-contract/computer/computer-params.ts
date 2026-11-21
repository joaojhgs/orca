import { z } from 'zod'

export const ComputerPermissionsStatusParams = z.object({})

export const ComputerCapabilitiesParams = z.object({})

export const ComputerDesktopStreamTicketParams = z.object({ desktopId: z.string().optional() })
export const ComputerDesktopTargetsParams = z.object({ executionHosts: z.boolean().optional() })
