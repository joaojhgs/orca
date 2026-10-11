import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import { getProjectGroupExecutionHostIdForRows } from '../listing/host-filtering'

export function createSidebarProjectGroupIndex(
  groups: readonly ProjectGroup[],
  defaultHostId: ExecutionHostId
) {
  const owner = (group: ProjectGroup) => getProjectGroupExecutionHostIdForRows(group, defaultHostId)
  const identity = (group: ProjectGroup) => JSON.stringify([owner(group), group.id])
  const byIdentity = new Map(groups.map((group) => [identity(group), group]))
  const byId = new Map<string, ProjectGroup[]>()
  for (const group of byIdentity.values()) {
    const candidates = byId.get(group.id) ?? []
    candidates.push(group)
    byId.set(group.id, candidates)
  }
  const resolve = (id: string, hostId: ExecutionHostId): ProjectGroup | undefined => {
    const candidates = byId.get(id) ?? []
    const exact = candidates.find((group) => owner(group) === hostId)
    if (exact) {
      return exact
    }
    // Why: local catalog groups can contain direct SSH projects, but not another paired server's.
    const localCatalog = candidates.find((group) => owner(group) === defaultHostId)
    if (!hostId.startsWith('runtime:') && localCatalog) {
      return localCatalog
    }
    return candidates.length === 1 ? candidates[0] : undefined
  }
  return { groups: [...byIdentity.values()], owner, identity, resolve }
}
