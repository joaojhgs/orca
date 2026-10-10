import { z } from 'zod'
import { ManagerScopeGrantSchema } from './manager-event-contract'

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
  'question:answer'
] as const

export const ManagerPrincipalGrantSchema = z.strictObject({
  scope: ManagerScopeGrantSchema,
  actions: z.array(z.enum(MANAGER_ACTIONS)).min(1).max(MANAGER_ACTIONS.length)
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
