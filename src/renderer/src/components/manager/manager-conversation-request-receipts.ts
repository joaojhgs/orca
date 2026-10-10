import {
  PendingManagerMutationSchema,
  type PendingManagerMutation
} from '../../../../shared/manager-conversation-request'
export type { PendingManagerMutation } from '../../../../shared/manager-conversation-request'
const receiptKey = (ownerKey: string) => `orca.manager.pending.v1:${ownerKey}`

// A tab's retry receipt survives reload; it is not task state and never contains a credential.
export function readPendingManagerMutation(ownerKey: string): PendingManagerMutation | null {
  const value = window.sessionStorage.getItem(receiptKey(ownerKey))
  return value === null ? null : PendingManagerMutationSchema.parse(JSON.parse(value))
}

export function savePendingManagerMutation(ownerKey: string, input: PendingManagerMutation): void {
  const parsed = PendingManagerMutationSchema.parse(input)
  window.sessionStorage.setItem(receiptKey(ownerKey), JSON.stringify(parsed))
}

export function clearPendingManagerMutation(ownerKey: string): void {
  window.sessionStorage.removeItem(receiptKey(ownerKey))
}
