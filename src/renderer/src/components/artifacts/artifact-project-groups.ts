import type { ArtifactListItem } from '../../../../shared/artifacts'
import type { Project, ProjectHostSetup } from '../../../../shared/project-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  normalizeRuntimePathForComparison,
  relativePathInsideRoot
} from '../../../../shared/cross-platform-path'

export type ArtifactProjectRoot = {
  projectId: string
  projectName: string
  hostId: string
  path: string
}
export type ArtifactProjectGroup = {
  id: string
  name: string
  artifacts: ArtifactListItem[]
}
export const UNASSIGNED_ARTIFACT_PROJECT = 'unassigned'

function repoFileHost(repo: Repo): string {
  return repo.connectionId ? `ssh:${repo.connectionId}` : (repo.executionHostId ?? 'local')
}

function setupFileHost(setup: ProjectHostSetup): string {
  return setup.connectionId ? `ssh:${setup.connectionId}` : (setup.executionHostId ?? setup.hostId)
}

export function artifactProjectRoots(catalog: {
  projects: readonly Project[]
  repos: readonly Repo[]
  setups: readonly ProjectHostSetup[]
  worktrees: readonly Worktree[]
  localHostId?: string | null
}): ArtifactProjectRoot[] {
  const roots: ArtifactProjectRoot[] = []
  const repoRoots = new Map<string, ArtifactProjectRoot>()
  for (const repo of catalog.repos) {
    const setup = catalog.setups.find(
      (item) => item.repoId === repo.id && setupFileHost(item) === repoFileHost(repo)
    )
    const project = catalog.projects.find(
      (item) => item.id === setup?.projectId || item.sourceRepoIds.includes(repo.id)
    )
    const root = {
      projectId: project?.id ?? setup?.projectId ?? repo.id,
      projectName: project?.displayName ?? repo.displayName,
      hostId: setup ? setupFileHost(setup) : repoFileHost(repo),
      path: repo.path
    }
    roots.push(root)
    repoRoots.set(JSON.stringify([repo.id, root.hostId]), root)
  }
  for (const setup of catalog.setups) {
    roots.push({
      projectId: setup.projectId,
      projectName:
        catalog.projects.find((item) => item.id === setup.projectId)?.displayName ??
        setup.displayName,
      hostId: setupFileHost(setup),
      path: setup.path
    })
  }
  for (const workspace of catalog.worktrees) {
    const repo = catalog.repos.find(
      (item) =>
        item.id === workspace.repoId &&
        (!workspace.hostId ||
          workspace.hostId === repoFileHost(item) ||
          workspace.hostId === item.executionHostId)
    )
    if (!repo) {
      continue
    }
    const hostId = repo.connectionId ? repoFileHost(repo) : (workspace.hostId ?? repoFileHost(repo))
    const root = repoRoots.get(JSON.stringify([repo.id, hostId]))
    if (root) {
      roots.push({ ...root, path: workspace.path })
    }
  }
  return catalog.localHostId
    ? [
        ...roots,
        ...roots
          .filter((root) => root.hostId === catalog.localHostId)
          .map((root) => ({ ...root, hostId: 'local' }))
      ]
    : roots
}

function sourceLocation(sourceKey: string): { hostId: string; path: string } | null {
  if (!sourceKey.startsWith('[')) {
    return { hostId: 'local', path: sourceKey }
  }
  try {
    const value: unknown = JSON.parse(sourceKey)
    if (!Array.isArray(value)) {
      return null
    }
    if (
      value.length === 3 &&
      value[0] === 'ssh' &&
      typeof value[1] === 'string' &&
      typeof value[2] === 'string'
    ) {
      return { hostId: `ssh:${value[1]}`, path: value[2] }
    }
    if (
      value.length === 4 &&
      value[0] === 'editor' &&
      typeof value[2] === 'string' &&
      typeof value[3] === 'string'
    ) {
      return { hostId: value[2], path: value[3] }
    }
  } catch {
    /* Legacy source keys need not be JSON. */
  }
  return null
}

export function artifactProject(
  item: ArtifactListItem,
  roots: readonly ArtifactProjectRoot[]
): ArtifactProjectRoot | null {
  const source = item.sourceKey ? sourceLocation(item.sourceKey) : null
  if (!source) {
    return null
  }
  let matches: ArtifactProjectRoot[] = []
  let longest = -1
  for (const root of roots) {
    if (root.hostId !== source.hostId) {
      continue
    }
    const path = normalizeRuntimePathForComparison(root.path)
    if (relativePathInsideRoot(root.path, source.path) === null) {
      continue
    }
    if (path.length > longest) {
      matches = [root]
      longest = path.length
    } else if (path.length === longest) {
      matches.push(root)
    }
  }
  return matches.length && matches.every((root) => root.projectId === matches[0]!.projectId)
    ? matches[0]!
    : null
}

export function groupArtifactsByProject(
  items: readonly ArtifactListItem[],
  roots: readonly ArtifactProjectRoot[],
  unassignedName: string
): ArtifactProjectGroup[] {
  const groups = new Map<string, ArtifactProjectGroup>()
  for (const item of items) {
    const project = artifactProject(item, roots)
    const id = project?.projectId ?? UNASSIGNED_ARTIFACT_PROJECT
    let group = groups.get(id)
    if (!group) {
      group = { id, name: project?.projectName ?? unassignedName, artifacts: [] }
      groups.set(id, group)
    }
    group.artifacts.push(item)
  }
  return [...groups.values()].sort((a, b) =>
    a.id === UNASSIGNED_ARTIFACT_PROJECT
      ? 1
      : b.id === UNASSIGNED_ARTIFACT_PROJECT
        ? -1
        : a.name.localeCompare(b.name)
  )
}
