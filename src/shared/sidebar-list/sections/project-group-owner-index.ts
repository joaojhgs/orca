import type { ProjectGroup } from '../../project/groups/project-group-types'
import {
  normalizeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../execution-host/execution-host'

export function createSidebarProjectGroupIndex(
  groups: readonly ProjectGroup[],
  defaultHostId: ExecutionHostId
) {
  const owner = (group: ProjectGroup): ExecutionHostId =>
    normalizeExecutionHostId(group.executionHostId) ??
    (group.connectionId ? toSshExecutionHostId(group.connectionId) : defaultHostId)
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
    return hostId === defaultHostId && candidates.length === 1 ? candidates[0] : undefined
  }
  const sectionId = (group: ProjectGroup): string =>
    (byId.get(group.id)?.length ?? 0) > 1 ? identity(group) : group.id
  return { groups: [...byIdentity.values()], owner, sectionId, resolve }
}
