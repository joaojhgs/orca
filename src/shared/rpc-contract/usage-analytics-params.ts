import { z } from 'zod'

const provider = z.enum(['claude', 'codex', 'opencode', 'muse'])
const rangeArgs = {
  provider,
  scope: z.enum(['orca', 'all']),
  range: z.enum(['7d', '30d', '90d', 'all'])
}
const limit = z.number().int().min(1).max(100).optional()

export const UsageAnalyticsParams = z.discriminatedUnion('operation', [
  z.object({ provider, operation: z.literal('getScanState') }),
  z.object({ provider, operation: z.literal('setEnabled'), enabled: z.boolean() }),
  z.object({ provider, operation: z.literal('refresh'), force: z.boolean().optional() }),
  z.object({ ...rangeArgs, operation: z.literal('getSnapshot'), limit }),
  z.object({ ...rangeArgs, operation: z.literal('getSummary') }),
  z.object({ ...rangeArgs, operation: z.literal('getDaily') }),
  z.object({
    ...rangeArgs,
    operation: z.literal('getBreakdown'),
    kind: z.enum(['model', 'project'])
  }),
  z.object({ ...rangeArgs, operation: z.literal('getRecentSessions'), limit })
])

export type UsageAnalyticsRequest = z.infer<typeof UsageAnalyticsParams>
