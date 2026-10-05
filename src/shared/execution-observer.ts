import { z } from 'zod'
import type { ProviderRateLimits } from './rate-limit-types'
import { skillLibraryWorkerRequestSchema } from './skill-library-worker-contract'
import { AndroidPreviewRequest } from './ssh-android-preview-contract'

export const executionCredentialSchema = z.object({
  sourceRef: z.string().min(1).max(200),
  provider: z.enum(['codex', 'claude', 'cursor', 'antigravity', 'opencode']),
  providerId: z.string().max(120).optional(),
  accountKey: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  identityConfidence: z.enum(['account', 'unknown']),
  credentialRevision: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional()
})
export type ExecutionCredential = z.infer<typeof executionCredentialSchema>

const workspaceProbeSchema = z.object({
  id: z.string().max(4096),
  repoId: z.string().max(4096),
  displayName: z.string().max(4096),
  path: z.string().max(16384)
})
export const executionObserverRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('discover') }),
  z.object({ operation: z.literal('usage'), credential: executionCredentialSchema }),
  z.object({ operation: z.literal('ports'), workspaces: z.array(workspaceProbeSchema).max(2000) }),
  AndroidPreviewRequest,
  ...skillLibraryWorkerRequestSchema.options
])
export type ExecutionObserverRequest = z.infer<typeof executionObserverRequestSchema>

export type ExecutionAccountUsage = ExecutionCredential & {
  id: string
  sources: {
    executionHostId: string
    label: string
    sourceRef: string
    reachable: boolean
    credentialRevision?: string
  }[]
  rateLimits: ProviderRateLimits | null
  checkedAt: number
  retryAt: number
  error?: string
}
