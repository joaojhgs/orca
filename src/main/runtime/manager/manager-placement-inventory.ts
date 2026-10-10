import type { OrcaRuntimeService } from '../orca-runtime'
import type { ManagerScopeGrant } from '../../../shared/manager-event-contract'
import { managerMayObserve } from '../../../shared/manager-event-contract'
import {
  getRepoExecutionHostId,
  getConnectionExecutionHostId
} from '../../../shared/execution-host'
import { getRepoMainWorktreeId } from '../../../shared/worktree/id'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import { managerWorkspaceScope } from './manager-hook-scope'

/** Known persisted locations only; this does not probe or clone unapproved hosts. */
export function managerPlacementInventory(runtime: OrcaRuntimeService, grant: ManagerScopeGrant) {
  const repos = runtime.listRepos()
  const setups = runtime.listProjectHostSetups()
  const folders = runtime.listFolderWorkspaces()
  const locations = [
    ...repos.map((repo) => ({
      workspaceId: getRepoMainWorktreeId(repo),
      executionHostId: getRepoExecutionHostId(repo),
      repoId: repo.id,
      name: repo.displayName,
      path: repo.path,
      kind: repo.kind ?? 'git'
    })),
    ...folders
      .filter((folder) => !folder.isArchived)
      .map((folder) => ({
        workspaceId: folderWorkspaceKey(folder.id),
        executionHostId:
          folder.executionHostId ?? getConnectionExecutionHostId(folder.connectionId),
        repoId: null,
        name: folder.name,
        path: folder.folderPath,
        kind: 'folder' as const
      }))
  ]
  return locations.flatMap((location) => {
    const scope = managerWorkspaceScope(
      location.workspaceId,
      location.executionHostId,
      repos,
      setups,
      folders
    )
    return scope && managerMayObserve(grant, scope) ? [{ ...location, scope }] : []
  })
}
