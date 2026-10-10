import type { NotificationPolicyScope } from '../../shared/notification-scope-policy'
import { getRepoExecutionHostId, getConnectionExecutionHostId } from '../../shared/execution-host'
import {
  normalizeWorkspaceSessionKeyToWorkspaceId,
  parseWorkspaceKey
} from '../../shared/workspace-scope'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import { getProjectHostSetupForRepo } from '../../shared/project-host-setup-lookup'
import type { RuntimeStore } from '../runtime/runtime-store-contract'

export function resolveNotificationPolicyScope(
  store: Pick<RuntimeStore, 'getRepos' | 'getProjectHostSetups' | 'getFolderWorkspaces'>,
  workspace: string | undefined,
  hint: NotificationPolicyScope = {}
): NotificationPolicyScope {
  if (!workspace) {
    return hint
  }
  const workspaceId = normalizeWorkspaceSessionKeyToWorkspaceId(workspace)
  const folderScope = parseWorkspaceKey(workspaceId)
  if (folderScope?.type === 'folder') {
    const matches = (store.getFolderWorkspaces?.() ?? []).filter(
      (row) =>
        row.id === folderScope.folderWorkspaceId &&
        (!hint.executionHostId ||
          (row.executionHostId ?? getConnectionExecutionHostId(row.connectionId)) ===
            hint.executionHostId)
    )
    const folder = matches.length === 1 ? matches[0] : undefined
    return folder
      ? {
          ...hint,
          workspaceId,
          projectGroupId: folder.projectGroupId,
          executionHostId:
            folder.executionHostId ?? getConnectionExecutionHostId(folder.connectionId)
        }
      : { ...hint, workspaceId }
  }
  const repoId = getRepoIdFromWorktreeId(workspaceId)
  const matches = store
    .getRepos()
    .filter(
      (repo) =>
        repo.id === repoId &&
        (!hint.executionHostId || getRepoExecutionHostId(repo) === hint.executionHostId)
    )
  const repo = matches.length === 1 ? matches[0] : undefined
  if (!repo) {
    return { ...hint, workspaceId }
  }
  return {
    ...hint,
    workspaceId,
    executionHostId: getRepoExecutionHostId(repo),
    projectId: getProjectHostSetupForRepo(
      (store.getProjectHostSetups?.() ?? []).filter(
        (row) => row.hostId === getRepoExecutionHostId(repo)
      ),
      repo
    ).projectId,
    ...(repo.projectGroupId ? { projectGroupId: repo.projectGroupId } : {})
  }
}
