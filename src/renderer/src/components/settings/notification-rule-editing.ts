import type { NotificationPolicyTarget } from '../../../../shared/notification-policy-target'
import { notificationSelectorKey } from '../../../../shared/notification-policy-target'
import type {
  NotificationScopePolicy,
  NotificationPolicyKind
} from '../../../../shared/notification-scope-policy'

export type NotificationRule = NotificationScopePolicy['rules'][number]
export const HUMAN_RULE_MODES = ['inherit', 'off', 'all', 'selected', 'manager-only'] as const
export type HumanRuleMode = (typeof HUMAN_RULE_MODES)[number]
export type RuleActor = 'any' | 'root' | 'worker' | 'manager'
export type RuleDestination = 'both' | 'desktop' | 'mobile'
export type ManagerDelivery = 'inherit' | 'on' | 'off'

export function findNotificationRule(
  policy: NotificationScopePolicy,
  target: NotificationPolicyTarget,
  actor: RuleActor,
  destination: RuleDestination
): NotificationRule | undefined {
  return policy.rules.findLast(
    (rule) =>
      notificationSelectorKey(rule.selector) === notificationSelectorKey(target.selector) &&
      (rule.actor ?? 'any') === actor &&
      (rule.human?.destinations?.length === 1 ? rule.human.destinations[0] : 'both') === destination
  )
}

export function editNotificationRule(
  policy: NotificationScopePolicy,
  target: NotificationPolicyTarget,
  actor: RuleActor,
  destination: RuleDestination,
  draft: {
    id: string
    mode: HumanRuleMode
    events: NotificationPolicyKind[]
    manager: ManagerDelivery
  }
): NotificationScopePolicy {
  const existing = findNotificationRule(policy, target, actor, destination)
  const rule: NotificationRule = {
    id: existing?.id ?? draft.id,
    selector: target.selector,
    ...(actor !== 'any' ? { actor } : {}),
    human: {
      mode: draft.mode,
      ...(draft.mode === 'selected' ? { events: draft.events } : {}),
      destinations: destination === 'both' ? ['desktop', 'mobile'] : [destination]
    },
    ...(draft.manager !== 'inherit' ? { manager: draft.manager === 'on' } : {})
  }
  return { ...policy, rules: [...policy.rules.filter((row) => row.id !== existing?.id), rule] }
}

export const NOTIFICATION_EVENT_LABELS: Record<NotificationPolicyKind, string> = {
  completion: 'Completion',
  failure: 'Failure',
  question: 'Question',
  permission: 'Permission',
  'contact-lost': 'Contact lost',
  'contact-restored': 'Contact restored',
  progress: 'Progress',
  bell: 'Terminal bell',
  test: 'Test'
}
