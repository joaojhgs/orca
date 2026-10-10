import { z } from 'zod'

export const MANAGER_EVENTS_RUNTIME_CAPABILITY = 'manager.durable-events.v1' as const

const stableId = z.string().min(1).max(512)

export const ManagerEventScopeSchema = z.strictObject({
  executionHostId: stableId,
  projectGroupId: stableId.optional(),
  projectId: stableId.optional(),
  workspaceId: z.string().min(1).max(4096).optional(),
  runId: stableId.optional(),
  dispatchId: stableId.optional(),
  sessionId: stableId.optional(),
  sessionGeneration: stableId.optional(),
  actor: z.enum(['manager', 'root', 'worker'])
})

export const MANAGER_EVENT_KINDS = [
  'turn-complete',
  'dispatch-settled',
  'question',
  'permission-wait',
  'failure',
  'contact-lost',
  'contact-restored',
  'progress',
  'mail'
] as const

export const ManagerEventInputSchema = z.strictObject({
  eventId: stableId,
  source: stableId,
  sourceGeneration: stableId,
  kind: z.enum(MANAGER_EVENT_KINDS),
  scope: ManagerEventScopeSchema,
  occurredAt: z.number().int().nonnegative(),
  summary: z.string().max(4096),
  messageId: stableId.optional(),
  outcome: z.enum(['succeeded', 'failed']).optional(),
  liveness: z.enum(['live', 'unverifiable', 'exited']).optional()
})

export const ManagerEventCursorSchema = z.strictObject({
  journalId: stableId,
  sequence: z.number().int().nonnegative()
})

export const ManagerScopeGrantSchema = z.strictObject({
  executionHostIds: z.array(stableId).min(1).max(100),
  projectIds: z.array(stableId).max(100),
  projectGroupIds: z.array(stableId).max(100).optional(),
  runIds: z.array(stableId).max(1000)
})

export type ManagerEventInput = z.infer<typeof ManagerEventInputSchema>
export type ManagerEventScope = z.infer<typeof ManagerEventScopeSchema>
export type ManagerEventCursor = z.infer<typeof ManagerEventCursorSchema>
export type ManagerScopeGrant = z.infer<typeof ManagerScopeGrantSchema>
export type ManagerEvent = ManagerEventInput & { sequence: number; recordedAt: number }
export type ManagerEventPage = {
  events: ManagerEvent[]
  cursor: ManagerEventCursor
  gap: 'journal-replaced' | 'retention-expired' | null
  hasMore: boolean
}

export function managerMayObserve(grant: ManagerScopeGrant, scope: ManagerEventScope): boolean {
  const groupGranted =
    scope.projectGroupId !== undefined &&
    grant.projectGroupIds?.includes(scope.projectGroupId) === true
  return (
    grant.executionHostIds.includes(scope.executionHostId) &&
    (scope.projectId === undefined || grant.projectIds.includes(scope.projectId) || groupGranted) &&
    (scope.runId === undefined || grant.runIds.includes(scope.runId)) &&
    (scope.projectId !== undefined ||
      scope.runId !== undefined ||
      groupGranted ||
      (scope.actor !== 'manager' &&
        scope.workspaceId === undefined &&
        scope.sessionId === undefined &&
        scope.dispatchId === undefined &&
        scope.projectGroupId === undefined))
  )
}
