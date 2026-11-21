import type { OccurrenceSectionPath } from '../lineage/worktree-occurrence-plan'
import type { RenderableFolderWorkspace } from '../folders/folder-workspace-lanes'
import type { ProjectGroup } from '../../project/groups/project-group-types'
import type { ProjectOrderBy } from '../../ui-chrome/ui-chrome-types'
import { createSidebarProjectGroupIndex } from './project-group-owner-index'
import { getProjectGroupHeaderKey } from './group-keys'
import { appendOrderedGroups } from './group-sections'
import type { SectionAppendContext } from './group-sections'
import type { OrderedGroupEntry } from './worktree-group-entry'
import { appendWorktreeRows } from './row-builders'
import { getFolderLaneSectionKey } from '../folders/folder-workspace-occurrences'
import { walkProjectGroupTree } from './project-group-tree'

export function appendProjectGroupSections(
  ctx: SectionAppendContext,
  args: {
    orderedGroups: OrderedGroupEntry[]
    projectGroups: readonly ProjectGroup[]
    folderWorkspaces: readonly RenderableFolderWorkspace[]
    projectOrderBy: ProjectOrderBy
    repoOrder: Map<string, number> | undefined
  }
): void {
  const { result, collapsedGroups } = ctx
  const index = createSidebarProjectGroupIndex(args.projectGroups, ctx.defaultHostId)
  // Folder membership is already resolved above grouping; only count here (#15362).
  const folderCountByGroupId = new Map<string, number>()
  for (const pair of args.folderWorkspaces) {
    const groupId = index.sectionId(pair.projectGroup)
    folderCountByGroupId.set(groupId, (folderCountByGroupId.get(groupId) ?? 0) + 1)
  }
  walkProjectGroupTree(
    {
      entries: args.orderedGroups,
      projectGroups: args.projectGroups,
      folderCountByGroupId,
      projectOrderBy: args.projectOrderBy,
      defaultHostId: ctx.defaultHostId,
      repoOrder: args.repoOrder
    },
    {
      group: (projectGroup, depth, count) => {
        const groupId = index.sectionId(projectGroup)
        const key = getProjectGroupHeaderKey(groupId)
        result.push({
          type: 'header',
          key,
          label: projectGroup.name,
          count,
          icon: { kind: 'project' },
          projectGroup,
          hostId: index.owner(projectGroup),
          projectGroupDepth: depth
        })
        if (collapsedGroups.has(key)) {
          return false
        }
        // The group's folders, with whatever is nested under them, precede its projects.
        appendWorktreeRows(result, ctx.repoOf, ctx.occurrencePlan, {
          collapsedGroups,
          groupDepth: depth + 1,
          sectionKey: getFolderLaneSectionKey(groupId),
          hostContextLabelByWorktreeIdentity: ctx.mixedWorktreeHostContextLabels,
          folderPairByIdentity: ctx.folderPairByIdentity
        })
        return true
      },
      projects: (entries, depth) => appendOrderedGroups(ctx, entries, depth)
    }
  )
}

/** The same group parents used by section emission, including missing-parent roots. */
export function getProjectGroupOccurrencePaths(
  index: ReturnType<typeof createSidebarProjectGroupIndex>
) {
  const paths = new Map<string, OccurrenceSectionPath>()
  for (const group of index.groups) {
    const pending: ProjectGroup[] = []
    const seen = new Set<string>()
    let current: ProjectGroup | undefined = group
    while (current) {
      const id = index.sectionId(current)
      if (paths.has(id) || seen.has(id)) {
        break
      }
      seen.add(id)
      pending.push(current)
      current = current.parentGroupId
        ? index.resolve(current.parentGroupId, index.owner(current))
        : undefined
    }
    let parent = current ? paths.get(index.sectionId(current)) : undefined
    for (let position = pending.length - 1; position >= 0; position -= 1) {
      const id = index.sectionId(pending[position])
      const path: OccurrenceSectionPath = { key: getProjectGroupHeaderKey(id), parent }
      paths.set(id, path)
      parent = path
    }
  }
  return paths
}
