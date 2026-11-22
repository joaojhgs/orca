import type { BotChatRow } from '../../shared/bots/bot-chat-row'
import type { BotMentionChat } from '../../shared/bots/bot-mention-context'

/** A picked chat as the host's own list has it: `--chat` only for one of the bot's chats that takes
 *  mail; any doubt (an unread list included) says it can't, and never falls back to the Home Chat. */
export function checkedChat(rows: readonly BotChatRow[] | null, chatId: string): BotMentionChat {
  if (!rows) {
    return { refused: 'unverifiable' }
  }
  const row = rows.find((entry) => entry.id === chatId)
  if (!row) {
    return { refused: 'not-its-chat' }
  }
  if (row.self) {
    return { refused: 'self' }
  }
  return row.closed ? { refused: row.reason ?? 'unverifiable' } : { id: row.id, title: row.title }
}
