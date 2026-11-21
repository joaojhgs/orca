import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent, MessageFooter, MessageHeader } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@/components/ui/message-scroller'
import { CommentMarkdownAsync } from '@/components/comment-markdown/comment-markdown-lazy'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'
import type { ManagerConversationMessage } from '../../../../shared/manager-conversation-contract'

export function ManagerTranscript(props: {
  messages: readonly ManagerConversationMessage[]
  busy: boolean
  canReply: boolean
  hasMore: boolean
  onMore(): void
  onAnswer(messageId: string): void
}): React.JSX.Element {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const answered = new Set(
    props.messages.flatMap((message) => (message.replyTo ? [message.replyTo] : []))
  )
  return (
    <div className="min-h-0 flex-1 p-4">
      <MessageScrollerProvider autoScroll>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto max-w-3xl">
              {props.messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === 'human'}
                >
                  <Message align={message.role === 'human' ? 'end' : 'start'}>
                    <MessageContent>
                      <MessageHeader>
                        {message.role === 'human'
                          ? t('manager.you', 'You')
                          : t('manager.hermes', 'Hermes')}
                      </MessageHeader>
                      <Bubble
                        variant={message.role === 'human' ? 'secondary' : 'ghost'}
                        align={message.role === 'human' ? 'end' : 'start'}
                      >
                        <BubbleContent>
                          <CommentMarkdownAsync content={message.body} />
                        </BubbleContent>
                      </Bubble>
                      <MessageFooter>
                        <div className="flex items-center gap-2">
                          <time dateTime={message.createdAt}>
                            {new Date(message.createdAt).toLocaleString(intlLocale)}
                          </time>
                          {message.kind === 'question' ? (
                            <>
                              <Badge variant="outline">
                                {answered.has(message.id)
                                  ? t('manager.answered', 'Answered')
                                  : t('manager.question', 'Question')}
                              </Badge>
                              {!answered.has(message.id) ? (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  disabled={props.busy || !props.canReply || props.hasMore}
                                  onClick={() => props.onAnswer(message.id)}
                                >
                                  {t('manager.answer', 'Answer')}
                                </Button>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </MessageFooter>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ))}
              {props.hasMore ? (
                <MessageScrollerItem messageId="manager-load-more">
                  <Button variant="outline" disabled={props.busy} onClick={props.onMore}>
                    {t('manager.loadMoreMessages', 'Load more messages')}
                  </Button>
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  )
}
