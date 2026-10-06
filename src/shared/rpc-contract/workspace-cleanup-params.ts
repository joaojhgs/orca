import { z } from 'zod'
import { parseExecutionHostId, type ExecutionHostId } from '../execution-host'

const id = z.string().min(1).max(128)
const worktreeId = z.string().min(1).max(8192)
const host = z.custom<ExecutionHostId>(
  (value) =>
    typeof value === 'string' && value.length <= 512 && parseExecutionHostId(value) !== null
)
const batch = z.object({ batchId: id }).strict()
export const WorkspaceCleanupControlParams = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('scan'),
      args: z
        .object({
          scanId: id.optional(),
          worktreeId: worktreeId.optional(),
          worktreeIds: z.array(worktreeId).max(500).optional(),
          skipGitWorktreeIds: z.array(worktreeId).max(500).optional(),
          includeAllWorkspaces: z.boolean().optional(),
          refreshActivity: z.boolean().optional()
        })
        .strict()
        .optional()
    })
    .strict(),
  z.object({ operation: z.literal('cancelScan'), scanId: id }).strict(),
  z.object({ operation: z.literal('getProgress'), scanId: id }).strict(),
  z.object({ operation: z.literal('getCachedScan') }).strict(),
  z
    .object({
      operation: z.literal('dismiss'),
      args: z
        .object({
          dismissals: z
            .array(
              z
                .object({
                  worktreeId,
                  executionHostId: host.optional(),
                  dismissedAt: z.number().finite(),
                  fingerprint: z.string().max(8192),
                  classifierVersion: z.literal(2)
                })
                .strict()
            )
            .max(500),
          removedWorktreeIds: z.array(worktreeId).max(500).optional()
        })
        .strict()
    })
    .strict(),
  z.object({ operation: z.literal('clearDismissals') }).strict(),
  z.object({ operation: z.literal('beginRemovalSnapshotPruneBatch'), args: batch }).strict(),
  z
    .object({
      operation: z.literal('recordRemovalSnapshotPrune'),
      args: batch
        .extend({
          worktreeId,
          executionHostId: host.optional()
        })
        .strict()
    })
    .strict(),
  z.object({ operation: z.literal('finishRemovalSnapshotPruneBatch'), args: batch }).strict()
])
export type WorkspaceCleanupControlRequest = z.infer<typeof WorkspaceCleanupControlParams>
