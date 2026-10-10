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
