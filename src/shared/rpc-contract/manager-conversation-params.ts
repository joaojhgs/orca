import { z } from 'zod'
import { ManagerConsumerLeaseSchema } from '../manager-principal-contract'
import { ManagerCompletionEvidenceSchema } from '../manager-completion-contract'

const id = z.string().min(1).max(512)
const body = z.string().trim().min(1).max(32_000)
export const ManagerConversationListParams = z.strictObject({
  offset: z.number().int().min(0).max(100_000).default(0),
  limit: z.number().int().min(1).max(100).default(50)
})
const page = {
  runId: id,
  afterSequence: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(100).default(50)
}
export const ManagerConversationCreateParams = z.strictObject({
  requestId: id,
  principalId: id,
  workspaceId: z.string().min(1).max(4096),
  objective: body
})
export const ManagerConversationShowParams = z.strictObject(page)
export const ManagerConversationSendParams = z.strictObject({
  requestId: id,
  runId: id,
  body,
  replyTo: id.optional()
})
export const ManagerConversationReadParams = z.strictObject({
  ...page,
  serviceToken: z.string().regex(/^orcam_[A-Za-z0-9_-]{43}$/)
})
export const ManagerConversationPostParams = z.strictObject({
  ...ManagerConversationSendParams.shape,
  serviceToken: ManagerConversationReadParams.shape.serviceToken,
  lease: ManagerConsumerLeaseSchema,
  kind: z.enum(['reply', 'question', 'progress']).default('reply'),
  completionEvidence: ManagerCompletionEvidenceSchema.optional()
})
