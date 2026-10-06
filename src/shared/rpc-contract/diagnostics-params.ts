import { z } from 'zod'

export const DiagnosticsSessionsParams = z
  .object({
    scope: z
      .object({ connectionId: z.string().min(1).max(512).nullable() })
      .strict()
      .optional()
  })
  .strict()
