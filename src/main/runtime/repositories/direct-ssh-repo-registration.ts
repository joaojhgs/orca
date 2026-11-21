import { randomUUID } from 'node:crypto'
import type { Repo } from '../../../shared/repository/repo-types'
import { normalizeRuntimePathForComparison } from '../../../shared/file-access/cross-platform-path'
import {
  getRepoSshConnectionId,
  toSshExecutionHostId
} from '../../../shared/execution-host/execution-host'
import { DEFAULT_REPO_BADGE_COLOR } from '../../../shared/repository/appearance/repo-badge-color'
import { getActiveMultiplexer } from '../../ssh/targets/ssh-target-registry'
import { requireSshGitProvider } from '../../providers/ssh-git-dispatch'
import { requireSshFilesystemProvider } from '../../providers/ssh-filesystem-dispatch'
import { detectRepoLocalMetadata } from '../../repository-icons/repo-icon-autodetect'
import type { RuntimeStore } from '../construction/runtime-store-contract'

export async function registerDirectSshRepo(
  store: RuntimeStore,
  args: { connectionId: string; path: string; kind: 'git' | 'folder'; displayName?: string }
): Promise<Repo> {
  const { connectionId, kind } = args
  const mux = getActiveMultiplexer(connectionId)
  if (!mux) {
    throw new Error('SSH target is not connected')
  }
  const requestedPath = args.path
  const resolved =
    requestedPath === '~' || requestedPath.startsWith('~/')
      ? await mux.request('session.resolveHome', { path: requestedPath })
      : null
  let path =
    resolved &&
    typeof resolved === 'object' &&
    'resolvedPath' in resolved &&
    typeof resolved.resolvedPath === 'string'
      ? resolved.resolvedPath
      : requestedPath
  const findExisting = () =>
    store
      .getRepos()
      .find(
        (repo) =>
          getRepoSshConnectionId(repo) === connectionId &&
          normalizeRuntimePathForComparison(repo.path) === normalizeRuntimePathForComparison(path)
      )
  const existing = findExisting()
  if (existing) {
    return existing
  }
  if (kind === 'git') {
    const gitInfo = await requireSshGitProvider(connectionId).isGitRepoAsync(path)
    if (!gitInfo.isRepo) {
      throw new Error(`Not a valid git repository: ${requestedPath}`)
    }
    path = gitInfo.rootPath ?? path
  } else {
    const folder = await requireSshFilesystemProvider(connectionId).stat(path)
    if (folder.type !== 'directory') {
      throw new Error(`Path is not a folder: ${requestedPath}`)
    }
  }
  const executionHostId = toSshExecutionHostId(connectionId)
  const detected = await detectRepoLocalMetadata({ repoPath: path, kind, executionHostId })
  const raceWinner = findExisting()
  if (raceWinner) {
    return raceWinner
  }
  const repo: Repo = {
    id: randomUUID(),
    path,
    displayName: args.displayName?.trim() || path.split(/[\\/]+/).findLast(Boolean) || path,
    badgeColor: DEFAULT_REPO_BADGE_COLOR,
    addedAt: Date.now(),
    kind,
    connectionId,
    executionHostId,
    ...detected,
    ...(kind === 'git'
      ? {
          externalWorktreeVisibilityLegacy: false,
          projectHostSetupMethod: 'imported-existing-folder'
        }
      : {})
  }
  store.addRepo(repo)
  mux.notify('session.registerRoot', { rootPath: path })
  return repo
}
