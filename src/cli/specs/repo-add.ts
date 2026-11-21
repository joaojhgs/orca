import type { CommandSpec } from '../discovery/command-spec'
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'

export const REPO_ADD_COMMAND_SPEC: CommandSpec = {
  path: ['repo', 'add'],
  summary: 'Add a project to Orca by filesystem path',
  usage:
    'orca repo add --path <path> [--kind git|folder] [--host <host-id>] [--project <id>] [--json]',
  allowedFlags: [...GLOBAL_FLAGS, 'path', 'kind', 'host', 'project'],
  notes: [
    'Use --host ssh:<connection-id> to register a checkout or folder that lives on an Orca SSH host.',
    'Defaults to git. Use --kind folder for an ordinary directory, including a parent of separate Git repositories. Attached Git worktrees appear in separate Source Control sections.',
    'With --environment or --host, pass an absolute path on the destination host.',
    'Use --project to group a folder workspace under an existing GitHub-backed Orca project.'
  ]
}
