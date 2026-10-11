import { z } from 'zod'
import { ManagerScopeGrantSchema } from './manager-event-contract'
import { ManagerDispatchPolicySchema } from './manager-dispatch-capacity-contract'

export const MANAGER_ACTIONS = [
  'events:read',
  'events:checkpoint',
  'inventory:read',
  'usage:read',
  'worker:read',
  'run:create',
  'task:write',
  'worker:start',
  'worker:guide',
  'question:answer',
  'conversation:write'
] as const

export const ManagerPrincipalGrantSchema = z.strictObject({
  scope: ManagerScopeGrantSchema,
  actions: z.array(z.enum(MANAGER_ACTIONS)).min(1).max(MANAGER_ACTIONS.length),
  maxActiveWorkers: z.number().int().min(1).max(8).optional(),
  dispatchPolicy: ManagerDispatchPolicySchema.optional()
})
export const ManagerConsumerLeaseSchema = z.strictObject({
  principalId: z.string().min(1).max(512),
  consumerId: z.string().min(1).max(512),
  generation: z.number().int().positive()
})
export type ManagerAction = (typeof MANAGER_ACTIONS)[number]
export type ManagerPrincipalGrant = z.infer<typeof ManagerPrincipalGrantSchema>
export type ManagerConsumerLease = z.infer<typeof ManagerConsumerLeaseSchema>
export type ManagerPrincipal = {
  id: string
  label: string
  grant: ManagerPrincipalGrant
  createdAt: number
  expiresAt: number
}
