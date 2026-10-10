import { z } from 'zod'
import {
  ManagerConversationCreateParams,
  ManagerConversationSendParams
} from '../../../../shared/rpc-contract/manager-conversation-params'

const PendingMutationSchema = z.discriminatedUnion('kind', [
  ManagerConversationCreateParams.extend({ kind: z.literal('create') }),
  ManagerConversationSendParams.extend({ kind: z.literal('send') })
])
export type PendingManagerMutation = z.infer<typeof PendingMutationSchema>
const receiptKey = (ownerKey: string) => `orca.manager.pending.v1:${ownerKey}`

// A tab's retry receipt survives reload; it is not task state and never contains a credential.
export function readPendingManagerMutation(ownerKey: string): PendingManagerMutation | null {
  const value = window.sessionStorage.getItem(receiptKey(ownerKey))
  return value === null ? null : PendingMutationSchema.parse(JSON.parse(value))
}

export function savePendingManagerMutation(ownerKey: string, input: PendingManagerMutation): void {
  const parsed = PendingMutationSchema.parse(input)
  window.sessionStorage.setItem(receiptKey(ownerKey), JSON.stringify(parsed))
}

export function clearPendingManagerMutation(ownerKey: string): void {
  window.sessionStorage.removeItem(receiptKey(ownerKey))
}
