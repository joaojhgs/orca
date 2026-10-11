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
      'orca manager conversation-post --lease <json> --request-id <id> --run <id> --body <text> [--kind <reply|question|progress>] [--reply-to <message>] [--completion-evidence <json>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'lease',
      'request-id',
      'run',
      'body',
      'kind',
      'reply-to',
      'completion-evidence'
    ],
    notes: [
      'Requires conversation:write. Replies do not settle Tasks or grant approval.',
      'Completion evidence must cover all canonical Tasks and exact accepted reports with separate verification Tasks; only verified root results notify.'
    ]
  }
]
