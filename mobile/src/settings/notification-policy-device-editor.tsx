import { useState } from 'react'
import { Pressable, Switch, Text, View } from 'react-native'
import {
  NOTIFICATION_POLICY_KINDS,
  type NotificationScopePolicy
} from '../../../src/shared/notification-scope-policy'
import { NOTIFICATION_EVENT_LABELS } from '../../../src/shared/notification-rule-editing'
import { notificationPolicyStyles as styles } from './notification-policy-choice'
import { useMobileTranslation } from '../i18n/use-mobile-translation'

export function NotificationPolicyDeviceEditor({
  policy,
  devices,
  busy,
  save
}: {
  policy: NotificationScopePolicy
  devices: { deviceId: string; name: string }[]
  busy: boolean
  save: (policy: NotificationScopePolicy) => Promise<void>
}) {
  const t = useMobileTranslation()
  const [expanded, setExpanded] = useState(false)
  const rows = new Map(devices.map((row) => [row.deviceId, row.name]))
  for (const override of policy.deviceOverrides) {
    if (!rows.has(override.deviceId)) {
      rows.set(override.deviceId, `Saved device ${override.deviceId} (not in current inventory)`)
    }
  }
  const update = (
    deviceId: string,
    changes: Partial<NotificationScopePolicy['deviceOverrides'][number]>
  ) => {
    const previous = policy.deviceOverrides.find((row) => row.deviceId === deviceId)
    void save({
      ...policy,
      deviceOverrides: [
        ...policy.deviceOverrides.filter((row) => row.deviceId !== deviceId),
        { ...previous, ...changes, deviceId }
      ]
    })
  }
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(
          'settings.serverNotifications.devices.deviceNotificationOverrides',
          'Device notification overrides'
        )}
        accessibilityState={{ expanded }}
        style={styles.row}
        onPress={() => setExpanded(!expanded)}
      >
        <Text style={styles.label}>
          {t(
            'settings.serverNotifications.devices.pairedDeviceOverrides',
            'Paired-device overrides'
          )}
        </Text>
        <Text style={styles.detail}>
          {t(
            'settings.serverNotifications.devices.deviceMutesAffectHuman',
            'Device mutes affect human alerts, not manager wake-ups.'
          )}
        </Text>
      </Pressable>
      {expanded &&
        [...rows].map(([deviceId, name]) => {
          const override = policy.deviceOverrides.find((row) => row.deviceId === deviceId)
          return (
            <View key={deviceId} style={styles.panel}>
              <Text style={[styles.label, styles.row]}>{name}</Text>
              <View style={styles.toggle}>
                <Text style={[styles.label, { flex: 1 }]}>
                  {t('settings.serverNotifications.devices.muteThisDevice', 'Mute this device')}
                </Text>
                <Switch
                  accessibilityLabel={t(
                    'settings.serverNotifications.devices.muteDevice',
                    'Mute {{value0}}',
                    { value0: name }
                  )}
                  disabled={busy}
                  value={override?.muted === true}
                  onValueChange={(muted) => update(deviceId, { muted })}
                />
              </View>
              <View style={styles.toggle}>
                <Text style={[styles.label, { flex: 1 }]}>
                  {t('settings.serverNotifications.devices.silentDelivery', 'Silent delivery')}
                </Text>
                <Switch
                  accessibilityLabel={t(
                    'settings.serverNotifications.devices.silentDeliveryFor',
                    'Silent delivery for {{value0}}',
                    { value0: name }
                  )}
                  disabled={busy}
                  value={override?.silent === true}
                  onValueChange={(silent) => update(deviceId, { silent })}
                />
              </View>
              {NOTIFICATION_POLICY_KINDS.map((kind) => (
                <View key={kind} style={styles.toggle}>
                  <Text style={[styles.detail, { flex: 1 }]}>
                    {t('settings.serverNotifications.devices.muteEvent', 'Mute')}{' '}
                    {NOTIFICATION_EVENT_LABELS[kind]}
                  </Text>
                  <Switch
                    accessibilityLabel={t(
                      'settings.serverNotifications.devices.muteEventForDevice',
                      'Mute {{value0}} for {{value1}}',
                      { value0: NOTIFICATION_EVENT_LABELS[kind], value1: name }
                    )}
                    disabled={busy}
                    value={override?.mutedEvents?.includes(kind) === true}
                    onValueChange={(muted) =>
                      update(deviceId, {
                        mutedEvents: muted
                          ? [...new Set([...(override?.mutedEvents ?? []), kind])]
                          : (override?.mutedEvents ?? []).filter((event) => event !== kind)
                      })
                    }
                  />
                </View>
              ))}
            </View>
          )
        })}
    </View>
  )
}
