import type { GitHubWorkItem } from '../../../../../shared/github/work-items/work-item-types'
import type { JiraIssue } from '../../../../../shared/jira/jira-types'
import type { LinearIssue } from '../../../../../shared/linear/issue-types'
import type { GitLabWorkItem } from '../../../../../shared/gitlab/gitlab-types'
import {
  getTaskSourceCacheScope,
  type TaskSourceContext
} from '../../../../../shared/work-items/task-source-context'
import {
  automationsPageLocationKey,
  type AutomationsPageLocation
} from './automations-page-location'

// Why: entries may be page sentinels, not just worktree IDs; names keep the "worktree" prefix for call-site stability.
export type WorktreeNavHistorySimpleViewEntry =
  | 'tasks'
  | 'automations'
  | 'artifacts'
  | 'skills'
  | 'manager'
const SIMPLE_VIEW_ENTRIES: readonly WorktreeNavHistorySimpleViewEntry[] = [
  'tasks',
  'automations',
  'artifacts',
  'manager',
  'skills'
]
export type WorktreeNavHistoryTaskDetailEntry =
  | {
      kind: 'task-detail'
      source: 'github'
      workItem: GitHubWorkItem
      sourceContext?: TaskSourceContext | null
      initialTab?: 'conversation' | 'checks' | 'files'
    }
  | {
      kind: 'task-detail'
      source: 'linear'
      issue: LinearIssue
      sourceContext?: TaskSourceContext | null
    }
  | {
      kind: 'task-detail'
      source: 'gitlab'
      workItem: GitLabWorkItem
      sourceContext?: TaskSourceContext | null
    }
  | {
      kind: 'task-detail'
      source: 'jira'
      issue: JiraIssue
      sourceContext?: TaskSourceContext | null
    }
/** One Automations sub-page, so titlebar Back steps through them like any other page. */
export type WorktreeNavHistoryAutomationsPageEntry = {
  kind: 'automations-page'
  location: AutomationsPageLocation
}
export type WorktreeNavHistoryViewEntry =
  | WorktreeNavHistorySimpleViewEntry
  | WorktreeNavHistoryTaskDetailEntry
  | WorktreeNavHistoryAutomationsPageEntry
export type WorktreeNavHistoryEntry = (string & {}) | WorktreeNavHistoryViewEntry

function isSimpleViewEntry(
  entry: WorktreeNavHistoryEntry
): entry is WorktreeNavHistorySimpleViewEntry {
  return typeof entry === 'string' && SIMPLE_VIEW_ENTRIES.some((view) => view === entry)
}

// Why: view entries count as live unconditionally — findWorktreeById can't resolve page sentinels.
export function isViewEntry(entry: WorktreeNavHistoryEntry): entry is WorktreeNavHistoryViewEntry {
  return isSimpleViewEntry(entry) || typeof entry === 'object'
}

export function isTaskStackEntry(entry: WorktreeNavHistoryEntry): boolean {
  return entry === 'tasks' || (typeof entry === 'object' && entry.kind === 'task-detail')
}

export function getHistoryEntryKey(entry: WorktreeNavHistoryEntry): string {
  if (typeof entry === 'string') {
    return isSimpleViewEntry(entry) ? `view:${entry}` : `worktree:${entry}`
  }
  if (entry.kind === 'automations-page') {
    return `view:automations-page:${automationsPageLocationKey(entry.location)}`
  }
  if (entry.source === 'github') {
    const sourceScope =
      entry.sourceContext?.provider === 'github'
        ? getTaskSourceCacheScope(entry.sourceContext)
        : 'legacy'
    return `view:task-detail:github:${sourceScope}:${entry.workItem.repoId}:${entry.workItem.type}:${entry.workItem.number}:${entry.initialTab ?? 'conversation'}`
  }
  if (entry.source === 'gitlab') {
    const sourceScope =
      entry.sourceContext?.provider === 'gitlab'
        ? getTaskSourceCacheScope(entry.sourceContext)
        : 'legacy'
    return `view:task-detail:gitlab:${sourceScope}:${entry.workItem.repoId}:${entry.workItem.type}:${entry.workItem.number}`
  }
  if (entry.source === 'jira') {
    const sourceScope =
      entry.sourceContext?.provider === 'jira'
        ? getTaskSourceCacheScope(entry.sourceContext)
        : 'legacy'
    return `view:task-detail:jira:${sourceScope}:${entry.issue.siteId ?? 'selected'}:${entry.issue.key}`
  }
  const sourceScope =
    entry.sourceContext?.provider === 'linear'
      ? getTaskSourceCacheScope(entry.sourceContext)
      : 'legacy'
  return `view:task-detail:linear:${sourceScope}:${entry.issue.workspaceId ?? 'selected'}:${entry.issue.id}`
}
