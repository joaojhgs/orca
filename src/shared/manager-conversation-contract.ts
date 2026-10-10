import { z } from 'zod'

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
