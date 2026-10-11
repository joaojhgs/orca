import { z } from 'zod'
import { NotificationScopePolicySchema } from './notification-scope-policy'
import type { NotificationScopePolicy, NotificationPolicyScope } from './notification-scope-policy'

export const NotificationPolicyReceiptSchema = z.object({
  policy: NotificationScopePolicySchema,
  revision: z.string().regex(/^[a-f0-9]{64}$/)
})
export const NotificationPolicyTargetsPageSchema = z.object({
  targets: z
    .array(
      z.object({
        label: z.string().min(1).max(4096),
        selector: NotificationScopePolicySchema.shape.rules.element.shape.selector,
        scope: z.object({
          executionHostId: z.string().optional(),
          projectGroupId: z.string().optional(),
          projectId: z.string().optional(),
          workspaceId: z.string().optional(),
          sessionId: z.string().optional(),
          sessionGeneration: z.string().optional(),
          actor: z.enum(['manager', 'root', 'worker']).optional()
        })
      })
    )
    .max(200),
  nextOffset: z.number().int().min(0).max(100_000).nullable()
})
export type NotificationPolicyReceipt = z.infer<typeof NotificationPolicyReceiptSchema>

export function notificationPolicyEditorTargets(
  targets: NotificationPolicyTarget[],
  policy: NotificationScopePolicy
): NotificationPolicyTarget[] {
  const rows = new Map(targets.map((target) => [notificationSelectorKey(target.selector), target]))
  for (const rule of policy.rules) {
    const key = notificationSelectorKey(rule.selector)
    if (!rows.has(key)) {
      rows.set(key, {
        label: `Saved ${rule.selector.level} override (not in current inventory)`,
        selector: rule.selector,
        scope: notificationSelectorScope(rule.selector)
      })
    }
  }
  return [...rows.values()]
}

export type NotificationPolicyTarget = {
  label: string
  selector: NotificationScopePolicy['rules'][number]['selector']
  scope: NotificationPolicyScope
}

export function notificationSelectorKey(selector: NotificationPolicyTarget['selector']): string {
  return JSON.stringify(selector)
}

export function notificationSelectorScope(
  selector: NotificationPolicyTarget['selector']
): NotificationPolicyScope {
  switch (selector.level) {
    case 'server':
      return {}
    case 'project-group':
      return { projectGroupId: selector.id }
    case 'project':
      return { projectId: selector.id }
    case 'workspace':
      return { workspaceId: selector.id, executionHostId: selector.executionHostId }
    case 'session':
      return { sessionId: selector.id, sessionGeneration: selector.generation }
  }
}
