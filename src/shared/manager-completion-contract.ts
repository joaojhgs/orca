import { z } from 'zod'

const id = z.string().min(1).max(512)
const git = z.strictObject({
  branch: z.string().min(1).max(512),
  commit: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/),
  clean: z.literal(true)
})

export const ManagerTaskRequirementsSchema = z.discriminatedUnion('role', [
  z.strictObject({
    role: z.literal('work'),
    tests: z.array(z.string().trim().min(1).max(2048)).max(32).default([]),
    gitBranch: z.string().min(1).max(512).optional()
  }),
  z.strictObject({ role: z.literal('verification'), verifiesTaskId: id })
])
export type ManagerTaskRequirements = z.infer<typeof ManagerTaskRequirementsSchema>

// Carried inside the authenticated verifier's existing worker_done report, not model authority.
export const ManagerVerificationReportSchema = z.strictObject({
  version: z.literal(1),
  verifiedTaskId: id,
  verifiedDispatchId: id,
  verifiedReportId: id,
  summary: z.string().trim().min(1).max(16_000),
  tests: z
    .array(
      z.strictObject({
        command: z.string().trim().min(1).max(2048),
        exitCode: z.literal(0),
        output: z.string().trim().min(1).max(4096)
      })
    )
    .max(32),
  git: git.optional()
})

export const ManagerCompletionEvidenceSchema = z
  .array(
    z.strictObject({
      taskId: id,
      dispatchId: id,
      reportId: id
    })
  )
  .min(1)
  .max(200)
export type ManagerCompletionEvidence = z.infer<typeof ManagerCompletionEvidenceSchema>

export const ManagerCompletionReceiptSchema = z.strictObject({
  verifiedAt: z.number().int().positive(),
  evidence: ManagerCompletionEvidenceSchema
})
