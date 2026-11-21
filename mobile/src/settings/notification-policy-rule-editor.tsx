import { useState } from 'react'
import { Pressable, Switch, Text, TextInput, View } from 'react-native'
import * as Crypto from 'expo-crypto'
import { PickerListDrawer } from '../components/sheets/PickerListDrawer'
import {
  editNotificationRule,
  findNotificationRule,
  HUMAN_RULE_MODES,
  HUMAN_DELIVERY_MODES,
  NOTIFICATION_EVENT_LABELS,
  type RuleActor,
  type RuleDestination,
  type HumanRuleMode,
  type HumanDeliveryMode,
  type ManagerDelivery
} from '../../../src/shared/notification-rule-editing'
import {
  NOTIFICATION_POLICY_KINDS,
  type NotificationPolicyKind,
  type NotificationScopePolicy
} from '../../../src/shared/notification-scope-policy'
import {
  notificationSelectorKey,
  type NotificationPolicyTarget
} from '../../../src/shared/notification-policy-target'
import { colors } from '../theme/mobile-theme'
import {
  NotificationPolicyChoice,
  notificationPolicyStyles as styles
} from './notification-policy-choice'
import { useMobileTranslation } from '../i18n/use-mobile-translation'

export function NotificationPolicyRuleEditor({
  policy,
  targets,
  busy,
  save
}: {
  policy: NotificationScopePolicy
  targets: NotificationPolicyTarget[]
  busy: boolean
  save: (policy: NotificationScopePolicy) => Promise<void>
}) {
  const t = useMobileTranslation()
  const actors: { value: RuleActor; label: string }[] = [
    {
      value: 'any',
      label: t('settings.serverNotifications.rules.anyAgent', 'Any agent')
    },
    {
      value: 'root',
      label: t('settings.serverNotifications.rules.mainAgent', 'Main agent')
    },
    {
      value: 'worker',
      label: t('settings.serverNotifications.rules.subagent', 'Subagent')
    },
    {
      value: 'manager',
      label: t('settings.serverNotifications.rules.hermesManager', 'Hermes manager')
    }
  ]
  const destinations: { value: RuleDestination; label: string }[] = [
    {
      value: 'both',
      label: t('settings.serverNotifications.rules.desktopAndMobile', 'Desktop and mobile')
    },
    {
      value: 'desktop',
      label: t('settings.serverNotifications.rules.desktop', 'Desktop')
    },
    {
      value: 'mobile',
      label: t('settings.serverNotifications.rules.mobile', 'Mobile')
    }
  ]
  const [scope, setScope] = useState(
    notificationSelectorKey(targets[0]?.selector ?? { level: 'server' })
  )
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [actor, setActor] = useState<RuleActor>('any')
  const [destination, setDestination] = useState<RuleDestination>('both')
  const target = targets.find((row) => notificationSelectorKey(row.selector) === scope)
  return (
    <View style={styles.section}>
      <TextInput
        accessibilityLabel={t(
          'settings.serverNotifications.rules.findNotificationScope',
          'Find notification scope'
        )}
        placeholder={t(
          'settings.serverNotifications.rules.findAProjectWorkspace',
          'Find a project, workspace or session'
        )}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        editable={!busy}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(
          'settings.serverNotifications.rules.notificationScope',
          'Notification scope'
        )}
        disabled={busy}
        style={styles.row}
        onPress={() => setOpen(true)}
      >
        <Text style={styles.label}>{t('settings.serverNotifications.rules.scope', 'Scope')}</Text>
        <Text style={styles.detail}>
          {target?.label ?? t('settings.serverNotifications.rules.chooseScope', 'Choose scope')}
        </Text>
      </Pressable>
      <PickerListDrawer
        visible={open && !busy}
        title={t('settings.serverNotifications.rules.notificationScope', 'Notification scope')}
        items={targets
          .filter((row) => row.label.toLowerCase().includes(query.toLowerCase()))
          .map((row) => ({
            ...row,
            id: notificationSelectorKey(row.selector),
            detail: row.selector.level
          }))}
        selectedId={scope}
        onSelect={(row) => setScope(row.id)}
        onClose={() => setOpen(false)}
      />
      <View style={styles.panel}>
        <NotificationPolicyChoice
          label={t('settings.serverNotifications.rules.agent', 'Agent')}
          value={actor}
          options={actors}
          disabled={busy}
          onChange={setActor}
        />
        <NotificationPolicyChoice
          label={t('settings.serverNotifications.rules.humanDestination', 'Human destination')}
          value={destination}
          options={destinations}
          disabled={busy}
          onChange={setDestination}
        />
      </View>
      {target && (
        <NotificationRuleDraft
          key={`${scope}:${actor}:${destination}:${JSON.stringify(findNotificationRule(policy, target, actor, destination))}`}
          {...{ policy, target, actor, destination, busy, save }}
        />
      )}
      <Text style={styles.detail}>
        {t(
          'settings.serverNotifications.rules.humanAlertsAndManager',
          'Human alerts and manager wake-ups are independent. These rules cannot turn a running YOLO approval or subagent completion into a main-agent stop alert.'
        )}
      </Text>
    </View>
  )
}

function NotificationRuleDraft({
  policy,
  target,
  actor,
  destination,
  busy,
  save
}: {
  policy: NotificationScopePolicy
  target: NotificationPolicyTarget
  actor: RuleActor
  destination: RuleDestination
  busy: boolean
  save: (policy: NotificationScopePolicy) => Promise<void>
}) {
  const t = useMobileTranslation()
  const managerOptions: { value: ManagerDelivery; label: string }[] = [
    {
      value: 'inherit',
      label: t('settings.serverNotifications.rules.inherit', 'Inherit')
    },
    {
      value: 'on',
      label: t('settings.serverNotifications.rules.enabled', 'Enabled')
    },
    {
      value: 'off',
      label: t('settings.serverNotifications.rules.disabled', 'Disabled')
    }
  ]
  const existing = findNotificationRule(policy, target, actor, destination)
  const [mode, setMode] = useState<HumanRuleMode>(existing?.human?.mode ?? 'inherit')
  const [delivery, setDelivery] = useState<HumanDeliveryMode>(
    existing?.human?.delivery ?? 'inherit'
  )
  const [events, setEvents] = useState<NotificationPolicyKind[]>(existing?.human?.events ?? [])
  const [manager, setManager] = useState<ManagerDelivery>(
    existing?.manager === undefined ? 'inherit' : existing.manager ? 'on' : 'off'
  )
  return (
    <>
      <View style={styles.panel}>
        <NotificationPolicyChoice
          label={t('settings.serverNotifications.rules.humanAlerts', 'Human alerts')}
          value={mode}
          disabled={busy}
          onChange={setMode}
          options={HUMAN_RULE_MODES.map((value) => ({
            value,
            label: value === 'manager-only' ? 'Manager only' : value
          }))}
        />
        <NotificationPolicyChoice
          label={t('settings.serverNotifications.rules.delivery', 'Delivery')}
          value={delivery}
          disabled={busy}
          onChange={setDelivery}
          options={HUMAN_DELIVERY_MODES.map((value) => ({ value, label: value }))}
        />
        <NotificationPolicyChoice
          label={t('settings.serverNotifications.rules.wakeManager', 'Wake manager')}
          value={manager}
          options={managerOptions}
          disabled={busy}
          onChange={setManager}
        />
        {mode === 'selected' &&
          NOTIFICATION_POLICY_KINDS.map((kind) => (
            <View key={kind} style={styles.toggle}>
              <Text style={[styles.label, { flex: 1 }]}>{NOTIFICATION_EVENT_LABELS[kind]}</Text>
              <Switch
                accessibilityLabel={NOTIFICATION_EVENT_LABELS[kind]}
                disabled={busy}
                value={events.includes(kind)}
                onValueChange={(enabled) =>
                  setEvents((rows) =>
                    enabled
                      ? [...rows.filter((row) => row !== kind), kind]
                      : rows.filter((row) => row !== kind)
                  )
                }
              />
            </View>
          ))}
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        accessibilityLabel={t(
          'settings.serverNotifications.rules.saveNotificationRule',
          'Save notification rule'
        )}
        style={[styles.primary, busy && styles.disabled]}
        onPress={() =>
          void save(
            editNotificationRule(policy, target, actor, destination, {
              id: Crypto.randomUUID(),
              mode,
              delivery,
              events,
              manager
            })
          )
        }
      >
        <Text style={styles.primaryText}>
          {busy
            ? t('settings.serverNotifications.rules.saving', 'Saving…')
            : t('settings.serverNotifications.rules.saveRule', 'Save rule')}
        </Text>
      </Pressable>
      {existing && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          accessibilityLabel={t(
            'settings.serverNotifications.rules.removeNotificationOverride',
            'Remove notification override'
          )}
          style={styles.secondary}
          onPress={() =>
            void save({ ...policy, rules: policy.rules.filter((row) => row.id !== existing.id) })
          }
        >
          <Text style={styles.detail}>
            {t('settings.serverNotifications.rules.removeOverride', 'Remove override')}
          </Text>
        </Pressable>
      )}
    </>
  )
}
