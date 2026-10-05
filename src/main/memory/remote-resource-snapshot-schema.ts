import { z } from 'zod'
import type { RemoteResourceSnapshot } from './remote-resource-provider-registry'

const bytes = z.number().nonnegative()
const hostSchema = z.object({
  totalMemory: bytes,
  freeMemory: bytes,
  availableMemory: bytes,
  availableMemorySource: z.enum(['memory-pressure', 'proc-meminfo', 'free-memory']),
  usedMemory: bytes,
  memoryUsagePercent: bytes,
  cpuCoreCount: z.number().int().positive(),
  loadAverage1m: bytes,
  cpuUsagePercent: bytes.optional(),
  diskTotal: bytes.optional(),
  diskUsed: bytes.optional(),
  diskAvailable: bytes.optional(),
  diskUsagePercent: bytes.optional()
})

export const remoteResourceSnapshotSchema: z.ZodType<RemoteResourceSnapshot> = z.object({
  host: hostSchema,
  worktrees: z.array(
    z.object({
      worktreeId: z.string().nullable(),
      sessions: z.array(
        z.object({
          sessionId: z.string(),
          paneKey: z.string().nullable(),
          pid: z.number().int().positive(),
          cpu: bytes,
          memory: bytes,
          privateMemory: bytes.optional()
        })
      )
    })
  )
})
