import type { CommandHandler } from '../dispatch'
import { ManagerConsumerLeaseSchema } from '../../shared/manager-principal-contract'

export function managerConversationHandlers(
  operation: (
    method: string,
    params: (flags: Map<string, string | boolean>) => Record<string, unknown>
  ) => CommandHandler,
  text: (flags: Map<string, string | boolean>, name: string) => string
): Record<string, CommandHandler> {
  return {
    'manager conversation-read': operation('manager.conversationRead', (flags) => ({
      runId: text(flags, 'run'),
      afterSequence: flags.has('after-sequence') ? Number(text(flags, 'after-sequence')) : 0,
      limit: flags.has('limit') ? Number(text(flags, 'limit')) : 50
    })),
    'manager conversation-post': operation('manager.conversationPost', (flags) => ({
      runId: text(flags, 'run'),
      lease: ManagerConsumerLeaseSchema.parse(JSON.parse(text(flags, 'lease'))),
      requestId: text(flags, 'request-id'),
      body: text(flags, 'body'),
      kind: flags.has('kind') ? text(flags, 'kind') : 'reply',
      replyTo: flags.has('reply-to') ? text(flags, 'reply-to') : undefined,
      completionEvidence: flags.has('completion-evidence')
        ? JSON.parse(text(flags, 'completion-evidence'))
        : undefined
    }))
  }
}
