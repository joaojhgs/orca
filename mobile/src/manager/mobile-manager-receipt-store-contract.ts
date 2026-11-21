import type { PendingManagerMutation } from '../../../src/shared/manager-conversation-request'

export type MobileManagerReceiptStore = {
  readonly ownerKey: string
  read: () => Promise<PendingManagerMutation | null>
  save: (request: PendingManagerMutation) => Promise<void>
  clear: (requestId: string) => Promise<void>
}

export type MobileManagerReceiptBinding = {
  store: MobileManagerReceiptStore | null
  error: string | null
}
