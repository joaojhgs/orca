import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const MANAGER_CONVERSATION_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['manager', 'conversation-read'],
    summary: 'Read the durable human/manager conversation for one owned Run',
    usage:
      'orca manager conversation-read --run <id> [--after-sequence <n>] [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run', 'after-sequence', 'limit'],
    notes: [
      'Follow nextSequence while hasMore is true; reading does not acknowledge mailbox delivery.'
    ]
  },
  {
    path: ['manager', 'conversation-post'],
    summary: 'Post one idempotent manager reply or genuine human question without a self-wake',
    usage:
      'orca manager conversation-post --lease <json> --request-id <id> --run <id> --body <text> [--kind <reply|question|progress>] [--reply-to <message>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'lease', 'request-id', 'run', 'body', 'kind', 'reply-to'],
    notes: [
      'Requires the explicit conversation:write grant. A reply never settles tasks or grants an approval.'
    ]
  }
]
