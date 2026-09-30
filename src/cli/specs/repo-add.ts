import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const REPO_ADD_COMMAND_SPEC: CommandSpec = {
  path: ['repo', 'add'],
  summary: 'Add a project to Orca by filesystem path',
  usage:
    'orca repo add --path <path> [--kind git|folder] [--host <host-id>] [--project <id>] [--json]',
  allowedFlags: [...GLOBAL_FLAGS, 'path', 'kind', 'host', 'project'],
  notes: [
    'Use --host ssh:<connection-id> to register a checkout or folder that lives on an Orca SSH host.',
    'Use --kind folder for a non-Git workspace directory.',
    'Use --project to group a folder workspace under an existing GitHub-backed Orca project.'
  ]
}
