import { useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { ManagerPublicPrincipal } from '../../../src/shared/manager-conversation-contract'
import { colors } from '../theme/mobile-theme'
import { ManagerButton } from './mobile-manager-button'
import { managerStyles as styles } from './mobile-manager-styles'
import type { MobileManagerConversations } from './use-mobile-manager-conversations'

export function MobileManagerObjectiveForm({ manager }: { manager: MobileManagerConversations }) {
  const [principalId, setPrincipalId] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [objective, setObjective] = useState('')
  const [search, setSearch] = useState('')
  const principals =
    manager.catalog?.principals.filter(
      (row) => row.state === 'active' && row.actions.includes('run:create')
    ) ?? []
  const principal: ManagerPublicPrincipal | undefined = principals.find(
    (row) => row.id === principalId
  )
  const workspace = manager.workspaces.find((row) => row.id === workspaceId)
  const disabled = manager.busy || Boolean(manager.pending) || !manager.recoveryReady
  return (
    <View style={styles.section}>
      <Text style={styles.title}>New objective</Text>
      <Text style={styles.meta}>
        Choose a manager and an exact workspace on this controller. The server enforces its grant.
      </Text>
      {principals.length === 0 ? (
        <Text style={styles.meta}>
          No active manager can create objectives. Configure a scoped manager on this controller.
        </Text>
      ) : null}
      {principals.map((row) => (
        <PressableChoice
          key={row.id}
          label={row.label}
          selected={row.id === principalId}
          disabled={disabled}
          onPress={() => setPrincipalId(row.id)}
        />
      ))}
      <ManagerButton disabled={manager.busy} onPress={() => void manager.loadWorkspaces()}>
        Load workspaces
      </ManagerButton>
      <TextInput
        accessibilityLabel="Find manager workspace"
        value={search}
        onChangeText={setSearch}
        placeholder="Find workspace or SSH host"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, styles.search]}
      />
      <ScrollView
        style={styles.choiceList}
        contentContainerStyle={styles.choiceContent}
        nestedScrollEnabled
      >
        {manager.workspaces
          .filter((row) => row.label.toLowerCase().includes(search.toLowerCase()))
          .map((row) => (
            <PressableChoice
              key={row.id}
              label={row.label}
              selected={row.id === workspaceId}
              disabled={disabled}
              onPress={() => setWorkspaceId(row.id)}
            />
          ))}
      </ScrollView>
      {workspace ? (
        <Text style={styles.meta}>Workspace: {workspace.label}</Text>
      ) : (
        <Text style={styles.meta}>Select a loaded workspace. No path or ID is guessed.</Text>
      )}
      <TextInput
        accessibilityLabel="Manager objective"
        multiline
        value={objective}
        onChangeText={setObjective}
        editable={!disabled}
        maxLength={32_000}
        placeholder="What should the manager achieve?"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
      />
      <ManagerButton
        primary
        disabled={disabled || !principal || !workspace || !objective.trim()}
        onPress={() => {
          if (principal && workspace) {
            void manager.create(principal.id, workspace.id, objective)
          }
        }}
      >
        Send objective
      </ManagerButton>
    </View>
  )
}

function PressableChoice(props: {
  label: string
  selected: boolean
  disabled: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ selected: props.selected, disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={[styles.row, props.selected && styles.selected]}
    >
      <Text style={styles.text}>{props.label}</Text>
    </Pressable>
  )
}
