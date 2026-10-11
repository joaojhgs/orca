import { useCallback, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { loadHostCatalog } from '../transport/host-store'
import { useAllHostClients } from '../transport/use-all-host-clients'
import {
  NotificationPolicyChoice,
  notificationPolicyStyles as styles
} from './notification-policy-choice'
import { useMobileNotificationPolicy } from './use-mobile-notification-policy'
import { NotificationPolicyRuleEditor } from './notification-policy-rule-editor'
import { NotificationPolicyDeviceEditor } from './notification-policy-device-editor'

export function NativeNotificationPolicySettings() {
  const [hosts, setHosts] = useState<{ id: string; name: string }[]>([])
  const [selected, setSelected] = useState('')
  const [catalogError, setCatalogError] = useState<string | null>(null)
  useFocusEffect(
    useCallback(() => {
      let current = true
      void loadHostCatalog()
        .then((rows) => {
          if (current) {
            setHosts(rows.map((row) => ({ id: row.id, name: row.name })))
            setCatalogError(null)
          }
        })
        .catch(() => {
          if (current) {
            setCatalogError('Could not load paired servers. Reopen this screen to retry.')
          }
        })
      return () => {
        current = false
      }
    }, [])
  )
  const clients = useAllHostClients(
    selected && hosts.some((row) => row.id === selected) ? [selected] : []
  )
  const entry = clients.find((row) => row.hostId === selected)
  const policy = useMobileNotificationPolicy(entry?.client ?? null, selected)
  return (
    <View style={styles.section}>
      <Text style={styles.label}>Server notification rules</Text>
      <Text style={styles.detail}>
        Choose the Orca server whose projects and manager events you want to configure.
      </Text>
      {hosts.length === 0 && (
        <Text style={styles.detail}>Pair an Orca server to edit its notification rules.</Text>
      )}
      <NotificationPolicyChoice
        label="Orca server"
        value={selected}
        options={[
          { value: '', label: 'Choose server' },
          ...hosts.map((row) => ({ value: row.id, label: row.name }))
        ]}
        onChange={setSelected}
      />
      {!!selected && !policy.connected && (
        <Text style={styles.detail}>
          Connecting to selected server… Reconnect that server if it remains unavailable.
        </Text>
      )}
      {policy.busy && (
        <Text style={styles.detail}>
          {policy.receipt ? 'Saving server rules…' : 'Loading server rules…'}
        </Text>
      )}
      {(catalogError || policy.error) && (
        <Text accessibilityRole="alert" style={styles.detail}>
          {catalogError ?? policy.error}
        </Text>
      )}
      {policy.connected && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh notification rules"
          disabled={policy.busy}
          style={styles.secondary}
          onPress={() => void policy.refresh()}
        >
          <Text style={styles.detail}>Refresh rules and scopes</Text>
        </Pressable>
      )}
      {policy.receipt && (
        <NotificationPolicyRuleEditor
          key={`${selected}:${entry?.client.getGeneration?.() ?? 0}`}
          policy={policy.receipt.policy}
          targets={policy.targets}
          busy={policy.busy}
          save={policy.save}
        />
      )}
      {policy.deviceError && (
        <Text accessibilityRole="alert" style={styles.detail}>
          {policy.deviceError}
        </Text>
      )}
      {policy.receipt && (
        <NotificationPolicyDeviceEditor
          policy={policy.receipt.policy}
          devices={policy.devices}
          busy={policy.busy}
          save={policy.save}
        />
      )}
    </View>
  )
}
