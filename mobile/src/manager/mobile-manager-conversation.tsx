import { useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { colors } from '../theme/mobile-theme'
import { ManagerButton } from './mobile-manager-button'
import { managerStyles as styles } from './mobile-manager-styles'
import type { MobileManagerConversations } from './use-mobile-manager-conversations'

export function MobileManagerConversation({ manager }: { manager: MobileManagerConversations }) {
  const [body, setBody] = useState('')
  const [replyTo, setReplyTo] = useState<string | undefined>()
  const detail = manager.detail
  const principal = manager.catalog?.principals.find((row) => row.id === detail?.principalId)
  const disabled =
    manager.busy ||
    Boolean(manager.pending) ||
    !manager.recoveryReady ||
    principal?.state !== 'active'
  if (!detail) {
    return <Text style={styles.meta}>Loading the recorded conversation…</Text>
  }
  const answered = new Set(
    detail.messages.filter((row) => row.role === 'human' && row.replyTo).map((row) => row.replyTo)
  )
  return (
    <View style={styles.section}>
      <Text style={styles.title}>{detail.run.objective}</Text>
      <Text style={styles.meta}>
        {principal?.label ?? 'Manager'} · {principal?.state ?? 'unconfirmed'} ·{' '}
        {principal?.consumerConnected ? 'Consumer connected' : 'Consumer not confirmed connected'}
      </Text>
      {principal?.state !== 'active' ? (
        <Text style={styles.meta}>
          History is read-only. This manager cannot receive new instructions.
        </Text>
      ) : null}
      {detail.messages.map((message) => (
        <View key={message.id} style={styles.message}>
          <Text style={styles.meta}>
            {message.role === 'human' ? 'You' : 'Manager'} · {message.kind}
          </Text>
          <MobileMarkdown content={message.body} rangeSelectable />
          {message.role === 'manager' &&
          message.kind === 'question' &&
          !answered.has(message.id) ? (
            <ManagerButton
              disabled={disabled}
              onPress={() => setReplyTo(message.id)}
              label={`Answer question ${message.sequence}`}
            >
              Answer this question
            </ManagerButton>
          ) : null}
        </View>
      ))}
      {detail.hasMore ? (
        <ManagerButton disabled={manager.busy} onPress={() => void manager.loadMore()}>
          Load more messages
        </ManagerButton>
      ) : null}
      {replyTo ? (
        <View style={styles.section}>
          <Text style={styles.meta}>
            Answering the selected recorded question. This does not change the manager’s safety
            grant.
          </Text>
          <ManagerButton onPress={() => setReplyTo(undefined)}>Cancel answer</ManagerButton>
        </View>
      ) : null}
      <TextInput
        accessibilityLabel={replyTo ? 'Answer manager question' : 'Message manager'}
        multiline
        value={body}
        onChangeText={setBody}
        maxLength={32_000}
        editable={!disabled}
        style={styles.input}
        placeholder={replyTo ? 'Your decision' : 'Follow-up instructions'}
        placeholderTextColor={colors.textMuted}
      />
      <ManagerButton
        primary
        disabled={disabled || !body.trim()}
        onPress={() => {
          void manager.send(body, replyTo).then((accepted) => {
            if (accepted) {
              setBody('')
              setReplyTo(undefined)
            }
          })
        }}
      >
        {replyTo ? 'Send answer' : 'Send message'}
      </ManagerButton>
    </View>
  )
}
