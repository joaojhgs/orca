import { z } from 'zod'
import { ManagerEventScopeSchema } from './manager-event-contract'
import { MANAGER_ACTIONS } from './manager-principal-contract'

export const ManagerConversationMessageSchema = z.strictObject({
  id: z.string(),
  runId: z.string(),
  sequence: z.number().int().positive(),
  role: z.enum(['human', 'manager']),
  kind: z.enum(['reply', 'question', 'progress']),
  body: z.string(),
  replyTo: z.string().nullable(),
  createdAt: z.string()
})
export type ManagerConversationMessage = z.infer<typeof ManagerConversationMessageSchema>

export const ManagerConversationPageSchema = z.strictObject({
  messages: z.array(ManagerConversationMessageSchema),
  nextSequence: z.number().int().nonnegative(),
  hasMore: z.boolean()
})

export const ManagerPublicPrincipalSchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  actions: z.array(z.enum(MANAGER_ACTIONS)),
  state: z.enum(['active', 'revoked', 'expired']),
  consumerConnected: z.boolean()
})
export type ManagerPublicPrincipal = z.infer<typeof ManagerPublicPrincipalSchema>
export const ManagerPrincipalPageSchema = z.strictObject({
  principals: z.array(ManagerPublicPrincipalSchema),
  nextOffset: z.number().int().nonnegative().nullable()
})
export const ManagerConversationSummarySchema = z.strictObject({
  runId: z.string(),
  principalId: z.string(),
  objective: z.string(),
  scope: ManagerEventScopeSchema
})
export type ManagerConversationSummary = z.infer<typeof ManagerConversationSummarySchema>
export const ManagerConversationCatalogSchema = z.strictObject({
  conversations: z.array(ManagerConversationSummarySchema),
  nextOffset: z.number().int().nonnegative().nullable()
})
export const ManagerConversationDetailSchema = ManagerConversationPageSchema.extend({
  run: z.object({ id: z.string(), objective: z.string() }),
  principalId: z.string()
})
export type ManagerConversationDetail = z.infer<typeof ManagerConversationDetailSchema>
export const ManagerConversationCreatedSchema = ManagerConversationPageSchema.extend({
  run: z.object({ id: z.string(), objective: z.string() }),
  scope: ManagerEventScopeSchema
})
export const ManagerConversationAcceptedSchema = z.strictObject({
  messageId: z.string().min(1),
  accepted: z.literal(true),
  delivery: z.literal('queued')
})
