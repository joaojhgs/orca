import { z } from 'zod'

const mib = 1024 * 1024
export const ManagerDispatchPolicySchema = z.strictObject({
  minimumAvailableMemoryBytes: z
    .number()
    .int()
    .min(64 * mib)
    .max(64 * 1024 * mib)
    .default(512 * mib),
  editMemoryBytes: z
    .number()
    .int()
    .min(64 * mib)
    .max(64 * 1024 * mib)
    .default(512 * mib),
  buildMemoryBytes: z
    .number()
    .int()
    .min(256 * mib)
    .max(64 * 1024 * mib)
    .default(2048 * mib),
  maxHostWorkers: z.number().int().min(1).max(16).default(4),
  maxHostBuildWorkers: z.number().int().min(1).max(8).default(1),
  maxAccountWorkers: z.number().int().min(1).max(16).default(4),
  maximumUsedPercent: z.number().min(1).max(100).default(95)
})
export type ManagerDispatchPolicy = z.infer<typeof ManagerDispatchPolicySchema>

export const ManagerDispatchReservationSchema = z.strictObject({
  executionHostId: z.string().min(1).max(512),
  accountId: z.string().min(1).max(512),
  workClass: z.enum(['edit', 'build']),
  memoryBytes: z.number().int().positive(),
  observedAt: z.number().int().positive()
})
export type ManagerDispatchReservation = z.infer<typeof ManagerDispatchReservationSchema>
