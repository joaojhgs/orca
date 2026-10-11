import { z } from 'zod'
import {
  ManagerReceiptOwnerKeySchema,
  PendingManagerMutationSchema
} from '../../../../src/shared/manager-conversation-request'

export const MANAGER_RECEIPT_VERBS = ['native.manager.receipt'] as const
export type ManagerReceiptVerb = (typeof MANAGER_RECEIPT_VERBS)[number]
export function isManagerReceiptVerb(verb: string): verb is ManagerReceiptVerb {
  return MANAGER_RECEIPT_VERBS.some((candidate) => candidate === verb)
}
export const managerReceiptReadParams = z.strictObject({
  operation: z.literal('read'),
  ownerKey: ManagerReceiptOwnerKeySchema.optional()
})
export const managerReceiptReadResult = z.strictObject({
  operation: z.literal('read'),
  ownerKey: ManagerReceiptOwnerKeySchema,
  receipt: PendingManagerMutationSchema.nullable()
})
export const managerReceiptSaveParams = z.strictObject({
  operation: z.literal('save'),
  ownerKey: ManagerReceiptOwnerKeySchema,
  request: PendingManagerMutationSchema
})
export const managerReceiptClearParams = z.strictObject({
  operation: z.literal('clear'),
  ownerKey: ManagerReceiptOwnerKeySchema,
  requestId: z.string().min(1).max(512)
})
export const managerReceiptMutationResult = z.strictObject({
  operation: z.enum(['save', 'clear']),
  ownerKey: ManagerReceiptOwnerKeySchema,
  confirmed: z.literal(true)
})
export const managerReceiptParams = z.discriminatedUnion('operation', [
  managerReceiptReadParams,
  managerReceiptSaveParams,
  managerReceiptClearParams
])
export const managerReceiptResult = z.discriminatedUnion('operation', [
  managerReceiptReadResult,
  managerReceiptMutationResult
])
