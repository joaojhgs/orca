import { z } from 'zod'
import type { ProviderRateLimits } from './rate-limit-types'
import type { WorkspacePortScanResult } from './workspace-ports'

const windowSchema = z.object({
  usedPercent: z.number().finite().min(0).max(100),
  // Zero denotes a total/lifetime budget, not a recurring quota window.
  windowMinutes: z.number().finite().nonnegative(),
  resetsAt: z.number().finite().nullable(),
  resetDescription: z.string().max(1000).nullable()
})
export const executionUsageSchema: z.ZodType<ProviderRateLimits> = z.object({
  provider: z.enum([
    'claude',
    'codex',
    'gemini',
    'opencode-go',
    'kimi',
    'minimax',
    'grok',
    'antigravity',
    'cursor',
    'zcode',
    'opencode'
  ]),
  session: windowSchema.nullable(),
  weekly: windowSchema.nullable(),
  fableWeekly: windowSchema.nullable().optional(),
  monthly: windowSchema.nullable().optional(),
  buckets: z
    .array(windowSchema.extend({ name: z.string().max(1000) }))
    .max(200)
    .optional(),
  planType: z.string().max(200).nullable().optional(),
  rateLimitResetCredits: z
    .object({
      availableCount: z.number().finite().nonnegative(),
      totalEarnedCount: z.number().finite().nonnegative().optional(),
      nextExpiresAt: z.number().finite().nullable().optional(),
      credits: z
        .array(
          z.object({
            status: z.string().max(100),
            expiresAt: z.number().finite().nullable(),
            grantedAt: z.number().finite().nullable()
          })
        )
        .max(1000)
        .optional()
    })
    .nullable()
    .optional(),
  updatedAt: z.number().finite(),
  error: z.string().max(2000).nullable(),
  status: z.enum(['idle', 'fetching', 'ok', 'error', 'unavailable']),
  usageMetadata: z
    .object({
      source: z.enum(['oauth', 'cli', 'web', 'live-session']).optional(),
      failureKind: z
        .enum([
          'missing-credentials',
          'stale-token',
          'refreshable-credentials-without-token',
          'delegated-refresh-required',
          'deferred-by-live-session',
          'keychain-unavailable',
          'missing-scope',
          'no-subscription',
          'network',
          'server',
          'parse',
          'rate-limited',
          'cli-unavailable',
          'usage-unavailable',
          'unknown'
        ])
        .optional(),
      credentialSource: z.string().max(200).optional(),
      authProvenance: z.string().max(200).optional(),
      retryAtMs: z.number().finite().optional()
    })
    .optional()
})
const portBase = z.object({
  id: z.string().max(1000),
  bindHost: z.string().max(255),
  connectHost: z.string().max(255),
  port: z.number().int().min(1).max(65535),
  pid: z.number().int().positive().optional(),
  processName: z.string().max(1000).optional(),
  protocol: z.enum(['http', 'https', 'unknown'])
})
export const executionPortsSchema: z.ZodType<WorkspacePortScanResult> = z.object({
  platform: z.enum([
    'linux',
    'darwin',
    'win32',
    'aix',
    'android',
    'freebsd',
    'haiku',
    'openbsd',
    'sunos',
    'cygwin',
    'netbsd',
    'unknown'
  ]),
  scannedAt: z.number().finite(),
  unavailableReason: z.string().max(1000).optional(),
  ports: z
    .array(
      z.discriminatedUnion('kind', [
        portBase.extend({
          kind: z.literal('workspace'),
          owner: z.object({
            worktreeId: z.string().max(4096),
            repoId: z.string().max(4096),
            displayName: z.string().max(4096),
            path: z.string().max(16384),
            confidence: z.enum(['cwd', 'command', 'none'])
          })
        }),
        portBase.extend({ kind: z.literal('container') }),
        portBase.extend({ kind: z.literal('external') })
      ])
    )
    .max(200)
})
