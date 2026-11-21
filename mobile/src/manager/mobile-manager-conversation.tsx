import { useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import { MobileMarkdown } from '../components/markdown/MobileMarkdown'
import { colors } from '../theme/mobile-theme'
import { ManagerButton } from './mobile-manager-button'
import { managerStyles as styles } from './mobile-manager-styles'
import type { MobileManagerConversations } from './use-mobile-manager-conversations'
import { useMobileTranslation } from '../i18n/use-mobile-translation'

export function MobileManagerConversation({ manager }: { manager: MobileManagerConversations }) {
  const t = useMobileTranslation()
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
    return (
      <Text style={styles.meta}>
        {t(
          'manager.conversation.loadingTheRecordedConversation',
          'Loading the recorded conversation…'
        )}
      </Text>
    )
  }
  const answered = new Set(
    detail.messages.filter((row) => row.role === 'human' && row.replyTo).map((row) => row.replyTo)
  )
  return (
    <View style={styles.section}>
      <Text style={styles.title}>{detail.run.objective}</Text>
      <Text style={styles.meta}>
        {principal?.label ?? t('manager.conversation.manager', 'Manager')} ·{' '}
        {principal?.state ?? t('manager.conversation.unconfirmed', 'unconfirmed')} ·{' '}
        {principal?.consumerConnected
          ? t('manager.conversation.consumerConnected', 'Consumer connected')
          : t(
              'manager.conversation.consumerNotConfirmedConnected',
              'Consumer not confirmed connected'
            )}
      </Text>
      {principal?.state !== 'active' ? (
        <Text style={styles.meta}>
          {t(
            'manager.conversation.historyIsReadOnly',
            'History is read-only. This manager cannot receive new instructions.'
          )}
        </Text>
      ) : null}
      {detail.messages.map((message) => (
        <View key={message.id} style={styles.message}>
          <Text style={styles.meta}>
            {message.role === 'human'
              ? t('manager.conversation.you', 'You')
              : t('manager.conversation.manager', 'Manager')}{' '}
            · {message.kind}
          </Text>
          <MobileMarkdown content={message.body} rangeSelectable />
          {message.role === 'manager' &&
          message.kind === 'question' &&
          !answered.has(message.id) ? (
            <ManagerButton
              disabled={disabled}
              onPress={() => setReplyTo(message.id)}
              label={t('manager.conversation.answerQuestion', 'Answer question {{value0}}', {
                value0: message.sequence
              })}
            >
              {t('manager.conversation.answerThisQuestion', 'Answer this question')}
            </ManagerButton>
          ) : null}
        </View>
      ))}
      {detail.hasMore ? (
        <ManagerButton disabled={manager.busy} onPress={() => void manager.loadMore()}>
          {t('manager.conversation.loadMoreMessages', 'Load more messages')}
        </ManagerButton>
      ) : null}
      {replyTo ? (
        <View style={styles.section}>
          <Text style={styles.meta}>
            {t(
              'manager.conversation.answeringTheSelectedRecorded',
              'Answering the selected recorded question. This does not change the manager’s safety grant.'
            )}
          </Text>
          <ManagerButton onPress={() => setReplyTo(undefined)}>
            {t('manager.conversation.cancelAnswer', 'Cancel answer')}
          </ManagerButton>
        </View>
      ) : null}
      <TextInput
        accessibilityLabel={
          replyTo
            ? t('manager.conversation.answerManagerQuestion', 'Answer manager question')
            : t('manager.conversation.messageManager', 'Message manager')
        }
        multiline
        value={body}
        onChangeText={setBody}
        maxLength={32_000}
        editable={!disabled}
        style={styles.input}
        placeholder={
          replyTo
            ? t('manager.conversation.yourDecision', 'Your decision')
            : t('manager.conversation.followUpInstructions', 'Follow-up instructions')
        }
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
        {replyTo
          ? t('manager.conversation.sendAnswer', 'Send answer')
          : t('manager.conversation.sendMessage', 'Send message')}
      </ManagerButton>
    </View>
  )
}
