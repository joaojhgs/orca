import { z } from 'zod'
import {
  ManagerConversationCreateParams,
  ManagerConversationSendParams
} from './rpc-contract/manager-conversation-params'

export const PendingManagerMutationSchema = z.discriminatedUnion('kind', [
  ManagerConversationCreateParams.extend({ kind: z.literal('create') }),
  ManagerConversationSendParams.extend({ kind: z.literal('send') })
])
export type PendingManagerMutation = z.infer<typeof PendingManagerMutationSchema>
export const ManagerReceiptOwnerKeySchema = z
  .string()
  .regex(/^orca:manager-pending:v1:[a-f0-9]{64}$/)
