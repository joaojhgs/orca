import { GLOBAL_FLAGS, type CommandSpec } from '../args'

const notes = [
  'Uses ORCA_MANAGER_TOKEN or a private ORCA_MANAGER_CREDENTIAL_FILE; never put a token in arguments.'
]
export const MANAGER_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['manager', 'worker-show'],
    summary:
      'Inspect an owned worker using host-authoritative liveness and existing dispatch state',
    usage: 'orca manager worker-show --run <id> --dispatch <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run', 'dispatch'],
    notes
  },
  {
    path: ['manager', 'worker-read'],
    summary: 'Read bounded worker output with the existing incarnation-fenced cursor protocol',
    usage:
      'orca manager worker-read --run <id> --dispatch <id> [--source <source>] [--cursor <json>] [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run', 'dispatch', 'source', 'cursor', 'limit'],
    notes
  },
  {
    path: ['manager', 'run-list'],
    summary: 'List only manager-owned Runs still inside the service grant',
    usage: 'orca manager run-list [--offset <n>] [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'offset', 'limit'],
    notes
  },
  {
    path: ['manager', 'task-list'],
    summary: 'Read a bounded page of task summaries from one manager-owned Run',
    usage: 'orca manager task-list --run <id> [--offset <n>] [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run', 'offset', 'limit'],
    notes
  },
  {
    path: ['manager', 'task-show'],
    summary: 'Read a task and latest dispatch from an explicitly addressed owned Run',
    usage: 'orca manager task-show --run <id> --task <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run', 'task'],
    notes
  },
  {
    path: ['manager', 'run-create'],
    summary: 'Create a manager-owned Run in an explicitly permitted workspace',
    usage:
      'orca manager run-create --lease <json> --request-id <id> --workspace-id <id> --objective <text> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'lease', 'request-id', 'workspace-id', 'objective'],
    notes: [...notes, 'Reuse the request ID after a timeout. This never adopts a user-owned Run.']
  },
  {
    path: ['manager', 'run-show'],
    summary: 'Read a Run owned by this manager without changing a current-Run binding',
    usage: 'orca manager run-show --run <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run'],
    notes
  },
  {
    path: ['manager', 'task-create'],
    summary: 'Add an idempotent Task to an explicitly addressed manager-owned Run',
    usage:
      'orca manager task-create --lease <json> --request-id <id> --run <id> --spec <text> [--title <text>] [--deps <ids>] [--parent <id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'lease',
      'request-id',
      'run',
      'spec',
      'title',
      'deps',
      'parent'
    ],
    notes
  },
  {
    path: ['manager', 'snapshot'],
    summary: 'Reconcile current status evidence without inventing missed events',
    usage: 'orca manager snapshot [--offset <n>] [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'offset', 'limit'],
    notes
  },
  {
    path: ['manager', 'read'],
    summary: 'Read durable events within the manager service grant',
    usage: 'orca manager read [--cursor <json>] [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'cursor', 'limit'],
    notes
  },
  {
    path: ['manager', 'wait'],
    summary: 'Wait for durable manager events without invoking a model',
    usage: 'orca manager wait [--cursor <json>] [--timeout-ms <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'cursor', 'timeout-ms'],
    notes
  },
  {
    path: ['manager', 'claim'],
    summary: 'Lease one fenced manager consumer',
    usage: 'orca manager claim --consumer <id> [--duration-ms <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'consumer', 'duration-ms'],
    notes
  },
  {
    path: ['manager', 'renew'],
    summary: 'Renew the same fenced consumer generation',
    usage: 'orca manager renew --lease <json> [--duration-ms <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'lease', 'duration-ms'],
    notes
  },
  {
    path: ['manager', 'release'],
    summary: 'Release the manager consumer lease without stopping workers',
    usage: 'orca manager release --lease <json> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'lease'],
    notes
  },
  {
    path: ['manager', 'checkpoint'],
    summary: 'Acknowledge events only after processing their decision',
    usage: 'orca manager checkpoint --lease <json> --cursor <json> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'lease', 'cursor'],
    notes
  },
  {
    path: ['manager', 'authorize'],
    summary: 'Issue a scoped manager credential into a new private file',
    usage:
      'orca manager authorize --label <name> --grant-file <path> --expires-at <ms> --credential-file <path> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'label', 'grant-file', 'expires-at', 'credential-file'],
    notes: [
      'Owner/paired administrator only. Existing credential files are never overwritten. Tokens are not printed.'
    ]
  },
  {
    path: ['manager', 'revoke'],
    destructive: true,
    summary: 'Revoke manager authority without stopping user workers',
    usage: 'orca manager revoke --principal <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'principal']
  }
]
