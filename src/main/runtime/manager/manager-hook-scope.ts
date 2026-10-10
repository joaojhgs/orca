import type { Repo } from '../../../shared/repo-types'
import type { ProjectHostSetup } from '../../../shared/project-types'
import type { ManagerEventScope } from '../../../shared/manager-event-contract'
import {
  getConnectionExecutionHostId,
  getRepoExecutionHostId
} from '../../../shared/execution-host'
import { getProjectHostSetupForRepo } from '../../../shared/project-host-setup-lookup'
import {
  normalizeWorkspaceSessionKeyToWorkspaceId,
  parseWorkspaceKey
} from '../../../shared/workspace-scope'
import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import { getRepoIdFromWorktreeId } from '../../../shared/worktree/id'
import type { EnrichedAgentHookEventPayload } from '../../agent-hooks/server/server-types'

export function managerHookScope(
  event: EnrichedAgentHookEventPayload,
  repos: readonly Repo[],
  setups: readonly ProjectHostSetup[],
  dispatch?: { id: string; run_id: string | null },
  folders: readonly FolderWorkspace[] = []
): ManagerEventScope | null {
  if (!event.worktreeId) {
    return null
  }
  return managerWorkspaceScope(
    normalizeWorkspaceSessionKeyToWorkspaceId(event.worktreeId),
    getConnectionExecutionHostId(event.connectionId),
    repos,
    setups,
    folders,
    dispatch
  )
}

export function managerWorkspaceScope(
  workspaceId: string,
  executionHostId: string,
  repos: readonly Repo[],
  setups: readonly ProjectHostSetup[],
  folders: readonly FolderWorkspace[] = [],
  dispatch?: { id: string; run_id: string | null }
): ManagerEventScope | null {
  const folderScope = parseWorkspaceKey(workspaceId)
  if (folderScope?.type === 'folder') {
    const matches = folders.filter(
      (row) =>
        row.id === folderScope.folderWorkspaceId &&
        (row.executionHostId ?? getConnectionExecutionHostId(row.connectionId)) === executionHostId
    )
    if (matches.length !== 1) {
      return null
    }
    return {
      executionHostId,
      workspaceId,
      projectGroupId: matches[0].projectGroupId,
      ...(dispatch
        ? { dispatchId: dispatch.id, ...(dispatch.run_id ? { runId: dispatch.run_id } : {}) }
        : {}),
      actor: dispatch ? 'worker' : 'root'
    }
  }
  const repoId = getRepoIdFromWorktreeId(workspaceId)
  const matches = repos.filter(
    (row) => row.id === repoId && getRepoExecutionHostId(row) === executionHostId
  )
  if (matches.length !== 1) {
    return null
  }
  const repo = matches[0]
  const project = getProjectHostSetupForRepo(
    setups.filter((row) => row.hostId === executionHostId),
    repo
  )
  return {
    executionHostId,
    workspaceId,
    projectId: project.projectId,
    ...(repo.projectGroupId ? { projectGroupId: repo.projectGroupId } : {}),
    ...(dispatch
      ? { dispatchId: dispatch.id, ...(dispatch.run_id ? { runId: dispatch.run_id } : {}) }
      : {}),
    actor: dispatch ? 'worker' : 'root'
  }
}
