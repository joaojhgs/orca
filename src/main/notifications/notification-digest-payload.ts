import { z } from 'zod'
import { AGENT_STATUS_STATES } from '../../shared/agent-status-types'
import {
  NOTIFICATION_POLICY_KINDS,
  type NotificationPolicyScope
} from '../../shared/notification-scope-policy'
import {
  isStructuredAttentionOrigin,
  type StructuredAttentionOrigin
} from '../../shared/agent-session-attention'
import { normalizeExecutionHostId } from '../../shared/execution-host'

const id = z.string().min(1).max(1024)
const scope = z.object({
  executionHostId: id.optional(),
  projectGroupId: id.optional(),
  projectId: id.optional(),
  workspaceId: id.optional(),
  sessionId: id.optional(),
  sessionGeneration: id.optional(),
  actor: z.enum(['manager', 'root', 'worker']).optional()
})
const fields = {
  worktreeId: id.optional(),
  notificationId: z.string().min(1).max(4096).optional(),
  notificationScope: scope.optional(),
  notificationKind: z.enum(NOTIFICATION_POLICY_KINDS).optional(),
  agentState: z.enum(AGENT_STATUS_STATES).optional(),
  attentionKey: id.optional(),
  structuredOrigin: z.custom<StructuredAttentionOrigin>(isStructuredAttentionOrigin).optional()
}
export const DesktopDigestPayloadSchema = z.object({
  request: z.object({
    ...fields,
    source: z.enum(['agent-task-complete', 'terminal-bell', 'test']),
    paneKey: id.optional(),
    notificationSourceId: id
      .transform((value, ctx) => {
        const host = normalizeExecutionHostId(value)
        if (!host) {
          ctx.addIssue({ code: 'custom', message: 'Invalid notification source' })
          return z.NEVER
        }
        return host
      })
      .optional(),
    surface: z.enum(['terminal', 'agent-session']).optional(),
    isActiveWorktree: z.boolean().optional()
  }),
  options: z.object({ title: z.string().max(1024), body: z.string().max(4096) })
})
export const PushDigestPayloadSchema = z.object({
  deviceId: id,
  registrationId: id,
  event: z.object({
    ...fields,
    type: z.literal('notification'),
    source: z.enum(['agent-task-complete', 'terminal-bell', 'test', 'plugin']),
    title: z.string().max(1024),
    body: z.string().max(4096),
    notificationSeq: z.number().int().nonnegative(),
    notificationEpoch: id,
    desktopAllowed: z.boolean().optional(),
    desktopAway: z.boolean().optional(),
    emittedAt: z.number().finite().optional()
  })
})
export type DesktopDigestPayload = z.infer<typeof DesktopDigestPayloadSchema>
export type PushDigestPayload = z.infer<typeof PushDigestPayloadSchema>
export function notificationDigestKey(
  scope: NotificationPolicyScope,
  kind: string,
  destination: string
): string {
  return JSON.stringify([
    destination,
    scope.executionHostId,
    scope.projectId,
    scope.workspaceId,
    scope.sessionId,
    scope.sessionGeneration,
    scope.actor,
    kind
  ])
}
export function notificationDigestBody(count: number, latestBody: string): string {
  return count > 1 ? `${count} eligible alerts recorded. Latest: ${latestBody}` : latestBody
}
