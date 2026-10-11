import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { useHostClient } from '../transport/client-context'
import { useHostDescriptor } from '../transport/host-descriptor-store'
import { firstParam } from '../navigation/route-param-reader'
import { colors } from '../theme/mobile-theme'
import { useMobileManagerConnectionKey } from './use-mobile-manager-connection-key'
import { useMobileManagerReceiptStore } from './use-mobile-manager-receipt-store'
import type { MobileManagerReceiptStore } from './mobile-manager-receipt-store-contract'
import { ManagerButton } from './mobile-manager-button'
import { MobileManagerConversation } from './mobile-manager-conversation'
import { MobileManagerObjectiveForm } from './mobile-manager-objective-form'
import { managerStyles as styles } from './mobile-manager-styles'
import { useMobileManagerConversations } from './use-mobile-manager-conversations'
import type { RpcClient } from '../transport/rpc-client'

export function MobileManagerScreen() {
  const params = useLocalSearchParams<{ hostId?: string | string[]; runId?: string | string[] }>()
  const hostId = firstParam(params.hostId)
  const initialRunId = firstParam(params.runId)
  const { client, clientId, state } = useHostClient(hostId)
  const descriptor = useHostDescriptor(hostId)
  const router = useRouter()
  const [foreground, setForeground] = useState(false)
  useFocusEffect(
    useCallback(() => {
      setForeground(true)
      return () => setForeground(false)
    }, [])
  )
  const { store: receipts, error: recoveryError } = useMobileManagerReceiptStore(hostId, clientId)
  const connectionKey = useMobileManagerConnectionKey(client, receipts?.ownerKey ?? null)
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          style={styles.icon}
          accessibilityRole="button"
          accessibilityLabel="Back to controller"
          onPress={() => router.back()}
        >
          <ChevronLeft size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>Manager</Text>
      </View>
      <Text style={styles.controller}>
        Controller: {descriptor?.machineName ?? hostId ?? 'Not selected'}
      </Text>
      {client && receipts && state === 'connected' ? (
        <ManagerSurface
          key={JSON.stringify([connectionKey, initialRunId])}
          client={client}
          receipts={receipts}
          foreground={foreground}
          initialRunId={initialRunId || undefined}
        />
      ) : (
        <View style={styles.content}>
          <Text style={styles.meta}>
            {recoveryError ??
              'Connect this paired controller to read manager conversations. Saved requests remain on this device.'}
          </Text>
        </View>
      )}
    </SafeAreaView>
  )
}

function ManagerSurface(props: {
  client: RpcClient
  receipts: MobileManagerReceiptStore
  foreground: boolean
  initialRunId?: string
}) {
  const manager = useMobileManagerConversations(
    props.client,
    props.receipts,
    props.foreground,
    props.initialRunId
  )
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ManagerButton disabled={manager.busy} onPress={() => void manager.refresh()}>
          Refresh
        </ManagerButton>
        {manager.busy ? (
          <View accessibilityLabel="Loading manager data">
            <ActivityIndicator color={colors.textSecondary} />
          </View>
        ) : null}
        {manager.error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {manager.error}
          </Text>
        ) : null}
        {!manager.recoveryReady ? (
          <Text style={styles.meta}>
            Request recovery is not ready. Sending is blocked; browsing remains available.
          </Text>
        ) : null}
        {manager.notice ? <Text style={styles.meta}>{manager.notice}</Text> : null}
        {manager.pending ? (
          <View style={styles.section}>
            <Text style={styles.meta}>
              A request is unconfirmed. Retry the saved request before sending another; do not
              duplicate it.
            </Text>
            <ManagerButton disabled={manager.busy} onPress={() => void manager.retry()}>
              Retry saved request
            </ManagerButton>
          </View>
        ) : null}
        {manager.runId ? (
          <>
            <ManagerButton disabled={manager.busy} onPress={() => manager.select(null)}>
              All objectives
            </ManagerButton>
            <MobileManagerConversation key={manager.runId} manager={manager} />
          </>
        ) : (
          <>
            <MobileManagerObjectiveForm manager={manager} />
            <Text style={styles.title}>Recorded objectives</Text>
            {manager.catalog?.conversations.map((row) => (
              <Pressable
                key={row.runId}
                accessibilityRole="button"
                accessibilityLabel={`Open objective: ${row.objective}`}
                disabled={manager.busy}
                onPress={() => manager.select(row.runId)}
                style={styles.row}
              >
                <Text style={styles.text}>{row.objective}</Text>
                <Text style={styles.meta}>{row.scope.executionHostId}</Text>
              </Pressable>
            ))}
            {manager.catalog?.conversations.length === 0 ? (
              <Text style={styles.meta}>No recorded objectives on this controller.</Text>
            ) : null}
            {manager.catalog?.nextOffset != null ? (
              <ManagerButton
                disabled={manager.busy}
                onPress={() => void manager.moreConversations()}
              >
                More objectives
              </ManagerButton>
            ) : null}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
