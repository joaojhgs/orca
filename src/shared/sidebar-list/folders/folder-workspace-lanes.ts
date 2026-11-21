import type { FolderWorkspace } from '../../folder-workspaces/folder-workspace-types'
import type { ProjectGroup } from '../../project/groups/project-group-types'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../execution-host/execution-host'
import { getFolderWorkspaceHostIdentity } from '../../folder-workspaces/folder-workspace-worktree'
import { getFolderWorkspaceExecutionHostIdForRows } from '../hosts/host-filtering'
import { createSidebarProjectGroupIndex } from '../sections/project-group-owner-index'
import type { WorkspaceStatusDefinition } from '../../worktree/types'
import {
  getWorkspaceStatus,
  getWorkspaceStatusGroupKey
} from '../../workspace/status/workspace-statuses'
import { ALL_GROUP_KEY } from '../sections/group-keys'
import { getPRLaneKey } from '../../workspace-view/workspace-pr-groups'
import { compareCodePoints, compareSidebarText } from '../sorting/text-order'
import type { WorktreeGroupBy } from '../row-types'

/** Carry the owning ProjectGroup through emission: FolderWorkspaceRow requires it and emitters cannot resolve owners. */
export type RenderableFolderWorkspace = {
  folderWorkspace: FolderWorkspace
  projectGroup: ProjectGroup
}

/** Resolve membership before grouping so every mode renders the same folder workspaces (#15362); modes choose lanes only. */
export function getRenderableFolderWorkspaces(
  folderWorkspaces: readonly FolderWorkspace[],
  projectGroups: readonly ProjectGroup[],
  defaultHostId: ExecutionHostId = LOCAL_EXECUTION_HOST_ID
): RenderableFolderWorkspace[] {
  const groups = createSidebarProjectGroupIndex(projectGroups, defaultHostId)
  const renderable = new Map<string, RenderableFolderWorkspace>()
  for (const folderWorkspace of folderWorkspaces) {
    const hostId = getFolderWorkspaceExecutionHostIdForRows({
      folderWorkspace,
      projectGroup: undefined,
      defaultHostId
    })
    const projectGroup = groups.resolve(folderWorkspace.projectGroupId, hostId)
    // A group filtered out for host visibility legitimately hides its workspaces.
    if (!projectGroup) {
      continue
    }
    const owner =
      folderWorkspace.executionHostId || folderWorkspace.connectionId
        ? hostId
        : groups.owner(projectGroup)
    const ownedWorkspace =
      owner !== LOCAL_EXECUTION_HOST_ID && owner !== folderWorkspace.executionHostId
        ? { ...folderWorkspace, executionHostId: owner }
        : folderWorkspace
    renderable.set(getFolderWorkspaceHostIdentity(ownedWorkspace), {
      folderWorkspace: ownedWorkspace,
      projectGroup
    })
  }
  return [...renderable.values()]
}

/** Switch exhaustively so new grouping modes cannot silently hide folder workspaces again. */
export function getFolderWorkspaceLaneKey(
  pair: RenderableFolderWorkspace,
  groupBy: Exclude<WorktreeGroupBy, 'repo'>,
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
): string {
  switch (groupBy) {
    case 'workspace-status':
      return getWorkspaceStatusGroupKey(getWorkspaceStatus(pair.folderWorkspace, workspaceStatuses))
    case 'pr-status':
      // Folders cannot resolve a PR; match worktrees without one in the in-progress lane.
      return getPRLaneKey('in-progress')
    case 'none':
      return ALL_GROUP_KEY
  }
}

type FolderWorkspaceDisplayOrder = Pick<
  FolderWorkspace,
  'id' | 'name' | 'sortOrder' | 'manualOrder' | 'executionHostId'
>

/** Match project-group ordering: user rank, then name. */
export function compareFolderWorkspacesForDisplay(
  left: FolderWorkspaceDisplayOrder,
  right: FolderWorkspaceDisplayOrder
): number {
  const leftOrder = left.manualOrder ?? left.sortOrder
  const rightOrder = right.manualOrder ?? right.sortOrder
  return (
    rightOrder - leftOrder ||
    compareSidebarText(left.name, right.name) ||
    compareCodePoints(left.executionHostId ?? '', right.executionHostId ?? '') ||
    compareCodePoints(left.id, right.id)
  )
}
