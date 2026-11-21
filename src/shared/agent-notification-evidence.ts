import { z } from 'zod'

export const agentNotificationEvidenceRequestSchema = z.object({
  operation: z.literal('agent-notification-evidence'),
  sessionId: z.string().uuid(),
  transcriptPath: z.string().max(16384).optional()
})
export const agentNotificationEvidenceSchema = z.object({
  state: z.enum(['working', 'done', 'interrupted', 'unverifiable']),
  approvalPolicy: z.string().max(64).optional(),
  approvalsReviewer: z.string().max(64).optional()
})
export type AgentNotificationEvidence = z.infer<typeof agentNotificationEvidenceSchema>
