import { z } from 'zod'

const id = z.string().min(1).max(1024)
export const NOTIFICATION_POLICY_KINDS = [
  'completion',
  'failure',
  'question',
  'permission',
  'contact-lost',
  'contact-restored',
  'progress',
  'bell',
  'test'
] as const
const selector = z.discriminatedUnion('level', [
  z.strictObject({ level: z.literal('server') }),
  z.strictObject({ level: z.literal('project-group'), id }),
  z.strictObject({ level: z.literal('project'), id }),
  z.strictObject({ level: z.literal('workspace'), id, executionHostId: id }),
  z.strictObject({ level: z.literal('session'), id, generation: id })
])
export const NotificationScopePolicySchema = z.strictObject({
  rules: z
    .array(
      z.strictObject({
        id,
        selector,
        actor: z.enum(['manager', 'root', 'worker']).optional(),
        human: z
          .strictObject({
            mode: z.enum(['inherit', 'off', 'all', 'selected', 'manager-only']),
            events: z
              .array(z.enum(NOTIFICATION_POLICY_KINDS))
              .max(NOTIFICATION_POLICY_KINDS.length)
              .optional(),
            destinations: z
              .array(z.enum(['desktop', 'mobile']))
              .min(1)
              .max(2)
              .optional()
          })
          .optional(),
        manager: z.boolean().optional()
      })
    )
    .max(500),
  deviceOverrides: z
    .array(
      z.strictObject({
        deviceId: id,
        muted: z.boolean().optional(),
        mutedEvents: z
          .array(z.enum(NOTIFICATION_POLICY_KINDS))
          .max(NOTIFICATION_POLICY_KINDS.length)
          .optional()
      })
    )
    .max(100)
})
export type NotificationScopePolicy = z.infer<typeof NotificationScopePolicySchema>
export type NotificationPolicyKind = (typeof NOTIFICATION_POLICY_KINDS)[number]
export type NotificationPolicyScope = {
  executionHostId?: string
  projectGroupId?: string
  projectId?: string
  workspaceId?: string
  sessionId?: string
  sessionGeneration?: string
  actor?: 'manager' | 'root' | 'worker'
}
const priority = { server: 0, 'project-group': 1, project: 2, workspace: 3, session: 4 }
function matches(
  rule: NotificationScopePolicy['rules'][number],
  scope: NotificationPolicyScope
): boolean {
  if (rule.actor && rule.actor !== scope.actor) {
    return false
  }
  const selected = rule.selector
  switch (selected.level) {
    case 'server':
      return true
    case 'project-group':
      return selected.id === scope.projectGroupId
    case 'project':
      return selected.id === scope.projectId
    case 'workspace':
      return selected.id === scope.workspaceId && selected.executionHostId === scope.executionHostId
    case 'session':
      return selected.id === scope.sessionId && selected.generation === scope.sessionGeneration
  }
}

/** Rules narrow an already eligible human alert; they never grant execution or fake a stop point. */
export function resolveNotificationScopePolicy(
  policy: NotificationScopePolicy | undefined,
  scope: NotificationPolicyScope,
  kind: NotificationPolicyKind,
  destination: 'desktop' | 'mobile',
  deviceId?: string
): {
  human: boolean
  manager: boolean
  humanRuleId: string | null
  managerRuleId: string | null
  deviceVeto: boolean
} {
  let human = true
  let manager = scope.actor !== 'manager'
  let humanRuleId: string | null = null
  let managerRuleId: string | null = null
  const rules = (policy?.rules ?? [])
    .filter((rule) => matches(rule, scope))
    .sort(
      (a, b) =>
        priority[a.selector.level] - priority[b.selector.level] ||
        Number(!!a.actor) - Number(!!b.actor)
    )
  for (const rule of rules) {
    if (rule.manager !== undefined) {
      manager = rule.manager && scope.actor !== 'manager'
      managerRuleId = rule.id
    }
    const setting = rule.human
    if (
      !setting ||
      setting.mode === 'inherit' ||
      (setting.destinations && !setting.destinations.includes(destination))
    ) {
      continue
    }
    human =
      setting.mode === 'all' ||
      (setting.mode === 'selected' && setting.events?.includes(kind) === true)
    humanRuleId = rule.id
  }
  const override = deviceId
    ? policy?.deviceOverrides.find((row) => row.deviceId === deviceId)
    : undefined
  const deviceVeto = override?.muted === true || override?.mutedEvents?.includes(kind) === true
  return { human: human && !deviceVeto, manager, humanRuleId, managerRuleId, deviceVeto }
}

export function normalizeNotificationScopePolicy(
  value: unknown
): NotificationScopePolicy | undefined {
  const parsed = NotificationScopePolicySchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}
