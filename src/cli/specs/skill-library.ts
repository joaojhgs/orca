import { GLOBAL_FLAGS, type CommandSpec } from '../args'

const HOST_FLAGS = [...GLOBAL_FLAGS, 'host']
export const SKILL_LIBRARY_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['skills', 'library', 'list'],
    aliases: [['skills', 'library', 'status']],
    summary: 'List server-local skill snapshots and caller-scoped assignments',
    usage: 'orca skills library list [--host local|ssh:<name-or-id> | --all-hosts] [--json]',
    allowedFlags: [...HOST_FLAGS, 'all-hosts'],
    notes: [
      'Versions are shared by the server library. Assignments default to the caller execution host; --all-hosts shows every assignment. No Orca Cloud account is used.'
    ]
  },
  {
    path: ['skills', 'library', 'discover'],
    summary: 'Discover importable skills on an execution host',
    usage: 'orca skills library discover [--host local|ssh:<name-or-id>] [--json]',
    allowedFlags: HOST_FLAGS
  },
  {
    path: ['skills', 'library', 'preview'],
    summary: 'Review a discovered skill and its supporting file inventory',
    usage:
      'orca skills library preview --skill <id-or-name> [--file <relative-path>] [--host <host>] [--json]',
    allowedFlags: [...HOST_FLAGS, 'skill', 'file']
  },
  {
    path: ['skills', 'library', 'import'],
    summary: 'Import explicitly reviewed immutable skill snapshots',
    usage:
      'orca skills library import --skill <id-or-name> [--skill <id-or-name> ...] --reviewed [--expected-digest <sha256>] [--add-version] [--host <host>] [--json]',
    allowedFlags: [...HOST_FLAGS, 'skill', 'reviewed', 'expected-digest', 'add-version'],
    notes: [
      'Review first with skills library preview. For a single skill, pass its preview packageDigest with --expected-digest to reject changes since review. Scripts and assets are included but never executed by import. Different content with an existing name needs explicit --add-version. Source folders are never modified.'
    ]
  },
  {
    path: ['skills', 'library', 'assign'],
    summary: 'Provision a pinned skill version for chosen coding runtimes',
    usage:
      'orca skills library assign --version-id <uuid> --agent <codex,claude,...> [--host <host>] [--worktree-id <id> | --folder-id <id>] [--json]',
    allowedFlags: [...HOST_FLAGS, 'version-id', 'agent', 'worktree-id', 'folder-id'],
    notes: [
      'Uses the selected host globally unless a registered workspace is selected. Runtime aliases share .agents/skills; assignments are provisioning choices, not access-control restrictions. Existing sessions may load skills only at their next normal start. Local edits and unowned skills are preserved.'
    ]
  },
  {
    path: ['skills', 'library', 'unassign'],
    summary: 'Remove only owned, unmodified skill placements',
    usage: 'orca skills library unassign --assignment-id <uuid> [--host <host>] [--json]',
    allowedFlags: [...HOST_FLAGS, 'assignment-id']
  },
  {
    path: ['skills', 'library', 'reconcile'],
    summary: 'Check and retry caller-scoped library assignments',
    usage:
      'orca skills library reconcile [--assignment-id <uuid>] [--host <host> | --all-hosts] [--json]',
    allowedFlags: [...HOST_FLAGS, 'assignment-id', 'all-hosts']
  },
  {
    path: ['skills', 'library', 'delete'],
    summary: 'Delete an unassigned library snapshot, never its original source',
    usage: 'orca skills library delete --version-id <uuid> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'version-id']
  }
]
