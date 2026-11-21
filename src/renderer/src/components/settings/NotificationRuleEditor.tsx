import { useRef, useState } from 'react'
import { createNonSecureContextUuid as createUuidV4 } from '../../../../shared/identifiers/non-secure-context-uuid'
import type { NotificationPolicyTarget } from '../../../../shared/notification-policy-target'
import {
  NOTIFICATION_POLICY_KINDS,
  resolveNotificationScopePolicy,
  type NotificationScopePolicy,
  type NotificationPolicyKind
} from '../../../../shared/notification-scope-policy'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '../ui/field'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select'
import {
  HUMAN_RULE_MODES,
  HUMAN_DELIVERY_MODES,
  NOTIFICATION_EVENT_LABELS,
  editNotificationRule,
  findNotificationRule,
  type RuleActor,
  type RuleDestination,
  type ManagerDelivery
} from './notification-rule-editing'
import { useTranslate } from '@/i18n/use-translate'

const modeLabels = {
  inherit: 'Inherit',
  off: 'Off',
  all: 'All eligible',
  selected: 'Selected events',
  'manager-only': 'Manager only'
}

export function NotificationRuleEditor({
  policy,
  target,
  actor,
  destination,
  save
}: {
  policy: NotificationScopePolicy
  target: NotificationPolicyTarget
  actor: RuleActor
  destination: RuleDestination
  save: (policy: NotificationScopePolicy) => Promise<void>
}): React.JSX.Element {
  const t = useTranslate()
  const rule = findNotificationRule(policy, target, actor, destination)
  const [mode, setMode] = useState(rule?.human?.mode ?? 'inherit')
  const [events, setEvents] = useState<NotificationPolicyKind[]>(
    rule?.human?.events ?? ['completion', 'failure', 'question']
  )
  const [manager, setManager] = useState<ManagerDelivery>(
    rule?.manager === undefined ? 'inherit' : rule.manager ? 'on' : 'off'
  )
  const [busy, setBusy] = useState(false)
  const [delivery, setDelivery] = useState(rule?.human?.delivery ?? 'inherit')
  const [previewKind, setPreviewKind] = useState<NotificationPolicyKind>('question')
  const pending = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const draft = editNotificationRule(policy, target, actor, destination, {
    id: rule?.id ?? 'preview',
    mode,
    events,
    manager,
    delivery
  })
  const scope = { ...target.scope, actor: actor === 'any' ? ('root' as const) : actor }
  const previewDestinations =
    destination === 'both' ? (['desktop', 'mobile'] as const) : [destination]
  function persist(reset: boolean): void {
    if (pending.current) {
      return
    }
    pending.current = true
    setBusy(true)
    setError(null)
    void Promise.resolve()
      .then(() =>
        save(
          reset
            ? { ...policy, rules: policy.rules.filter((row) => row.id !== rule?.id) }
            : editNotificationRule(policy, target, actor, destination, {
                id: createUuidV4(),
                mode,
                events,
                manager,
                delivery
              })
        )
      )
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not save this rule. Retry after refreshing settings.'
        )
      })
      .finally(() => {
        pending.current = false
        setBusy(false)
      })
  }
  return (
    <FieldGroup>
      <Field data-disabled={busy}>
        <FieldLabel id="notification-human-mode">
          {t('auto.components.settings.NotificationRuleEditor.0fd34b8848', 'Human alerts')}
        </FieldLabel>
        <ToggleGroup
          type="single"
          value={mode}
          aria-labelledby="notification-human-mode"
          disabled={busy}
          className="flex-wrap justify-start"
          onValueChange={(value) => {
            const selected = HUMAN_RULE_MODES.find((option) => option === value)
            if (selected) {
              setMode(selected)
            }
          }}
        >
          {HUMAN_RULE_MODES.map((value) => (
            <ToggleGroupItem key={value} value={value}>
              {modeLabels[value]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FieldDescription>
          {t(
            'auto.components.settings.NotificationRuleEditor.3f64b63fbf',
            'Rules only filter eligible stop points. Child completion and YOLO permission requests do not become human alerts. Manager only permits alerts from the manager conversation, not other agents.'
          )}
        </FieldDescription>
      </Field>
      {mode === 'selected' && (
        <FieldSet disabled={busy}>
          <FieldLegend>
            {t('auto.components.settings.NotificationRuleEditor.edb1fb7dac', 'Selected events')}
          </FieldLegend>
          <FieldGroup>
            {NOTIFICATION_POLICY_KINDS.map((kind) => (
              <Field key={kind} orientation="horizontal">
                <Checkbox
                  id={`notification-kind-${kind}`}
                  checked={events.includes(kind)}
                  onCheckedChange={(checked) =>
                    setEvents((current) =>
                      checked === true
                        ? [...new Set([...current, kind])]
                        : current.filter((value) => value !== kind)
                    )
                  }
                />
                <FieldLabel htmlFor={`notification-kind-${kind}`}>
                  {NOTIFICATION_EVENT_LABELS[kind]}
                </FieldLabel>
              </Field>
            ))}
          </FieldGroup>
        </FieldSet>
      )}
      <Field data-disabled={busy}>
        <FieldLabel id="notification-human-delivery">
          {t('auto.components.settings.NotificationRuleEditor.5dd42d6dda', 'Human delivery')}
        </FieldLabel>
        <ToggleGroup
          type="single"
          value={delivery}
          aria-labelledby="notification-human-delivery"
          disabled={busy}
          className="justify-start"
          onValueChange={(value) => {
            const selected = HUMAN_DELIVERY_MODES.find((option) => option === value)
            if (selected) {
              setDelivery(selected)
            }
          }}
        >
          <ToggleGroupItem value="inherit">
            {t('auto.components.settings.NotificationRuleEditor.5edc7f565f', 'Inherit')}
          </ToggleGroupItem>
          <ToggleGroupItem value="immediate">
            {t('auto.components.settings.NotificationRuleEditor.1a5fd60bd9', 'Immediate')}
          </ToggleGroupItem>
          <ToggleGroupItem value="silent">
            {t('auto.components.settings.NotificationRuleEditor.2ecf22b180', 'Silent')}
          </ToggleGroupItem>
          <ToggleGroupItem value="digest">
            {t('auto.components.settings.NotificationRuleEditor.082246c7af', 'One-minute digest')}
          </ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription>
          {t(
            'auto.components.settings.NotificationRuleEditor.864aae712b',
            'Silent keeps eligible alerts but disables system and custom sounds. It does not unmute alerts or delay manager wake-ups. Digests batch by session and event type for one minute, persist on the server and arrive silently. Device sound disables remain final vetoes.'
          )}
        </FieldDescription>
      </Field>
      <Field data-disabled={busy}>
        <FieldLabel id="notification-manager-mode">
          {t(
            'auto.components.settings.NotificationRuleEditor.4153b64048',
            'Manager event subscription'
          )}
        </FieldLabel>
        <ToggleGroup
          type="single"
          value={manager}
          aria-labelledby="notification-manager-mode"
          disabled={busy}
          className="justify-start"
          onValueChange={(value) => {
            if (value === 'inherit' || value === 'on' || value === 'off') {
              setManager(value)
            }
          }}
        >
          <ToggleGroupItem value="inherit">
            {t('auto.components.settings.NotificationRuleEditor.5edc7f565f', 'Inherit')}
          </ToggleGroupItem>
          <ToggleGroupItem value="on">
            {t('auto.components.settings.NotificationRuleEditor.e39c8be816', 'On')}
          </ToggleGroupItem>
          <ToggleGroupItem value="off">
            {t('auto.components.settings.NotificationRuleEditor.48d864e1d2', 'Off')}
          </ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription>
          {t(
            'auto.components.settings.NotificationRuleEditor.f23116b288',
            'Independent of human alerts and device mutes. Off explicitly disables supervision events for this scope; the manager cannot wake itself.'
          )}
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="notification-preview-kind">
          {t('auto.components.settings.NotificationRuleEditor.7ae0f096a7', 'Preview event')}
        </FieldLabel>
        <Select
          value={previewKind}
          onValueChange={(value) => {
            const kind = NOTIFICATION_POLICY_KINDS.find((candidate) => candidate === value)
            if (kind) {
              setPreviewKind(kind)
            }
          }}
        >
          <SelectTrigger id="notification-preview-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {NOTIFICATION_POLICY_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {NOTIFICATION_EVENT_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          {t(
            'auto.components.settings.NotificationRuleEditor.2b03bae562',
            'Policy only, not transport or delivery confirmation. All roles previews the main agent; role-specific rules may differ.'
          )}
        </FieldDescription>
      </Field>
      {previewDestinations.map((channel) => {
        const preview = resolveNotificationScopePolicy(draft, scope, previewKind, channel)
        const describe = (id: string | null) => {
          const applied = draft.rules.find((row) => row.id === id)
          return applied
            ? `${applied.selector.level} override${applied.actor ? ` (${applied.actor})` : ''}`
            : 'default'
        }
        return (
          <output key={channel} className="text-xs text-muted-foreground" aria-live="polite">
            {t(
              'auto.components.settings.NotificationRuleEditor.effectivePreview',
              '{{event}} ({{channel}}, {{actor}}): human {{human}} by {{humanScope}}; manager {{manager}} by {{managerScope}}. Human delivery: {{delivery}} by {{deliveryScope}}.',
              {
                event: NOTIFICATION_EVENT_LABELS[previewKind],
                channel,
                actor: scope.actor,
                human: preview.human
                  ? t('auto.components.settings.NotificationRuleEditor.f4a779626c', 'allowed')
                  : t('auto.components.settings.NotificationRuleEditor.46c8fd28cd', 'muted'),
                humanScope: describe(preview.humanRuleId),
                manager: preview.manager
                  ? t('auto.components.settings.NotificationRuleEditor.202272e91f', 'subscribed')
                  : t('auto.components.settings.NotificationRuleEditor.1dd346243f', 'off'),
                managerScope: describe(preview.managerRuleId),
                delivery: preview.delivery,
                deliveryScope: describe(preview.deliveryRuleId)
              }
            )}
          </output>
        )
      })}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => void persist(false)}>
          {t('auto.components.settings.NotificationRuleEditor.32927ddd30', 'Save rule')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !rule}
          onClick={() => void persist(true)}
        >
          {t('auto.components.settings.NotificationRuleEditor.525ff165e0', 'Remove override')}
        </Button>
      </div>
    </FieldGroup>
  )
}
