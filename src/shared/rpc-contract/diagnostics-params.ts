import { z } from 'zod'

export const DiagnosticsSessionsParams = z
  .object({
    scope: z
      .object({
        connectionId: z.string().min(1).max(512).nullable(),
        includeUnrouted: z.boolean().optional()
      })
      .strict()
      .refine((scope) => !scope.includeUnrouted || scope.connectionId === null, {
        message: 'Unrouted inventory requires the local host'
      })
      .optional()
  })
  .strict()
