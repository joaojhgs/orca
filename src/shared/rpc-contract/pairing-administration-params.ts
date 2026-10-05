import { z } from 'zod'

export const PairingAdministrationQrParams = z
  .object({
    address: z.string().trim().min(1).max(2048).optional(),
    connectionMode: z.enum(['automatic', 'local-only']).optional(),
    rotate: z.boolean().optional()
  })
  .strict()

export const PairingAdministrationDeviceParams = z
  .object({ deviceId: z.string().min(1).max(256) })
  .strict()
