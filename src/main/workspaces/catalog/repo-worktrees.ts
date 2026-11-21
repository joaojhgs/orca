import { preserveFolderUpgradeWorktreePath } from './folder-upgrade-worktree-path'
import type { Repo } from '../../../shared/repository/repo-types'
import type { GitWorktreeInfo } from '../../../shared/worktree/types'
import {
  listWorktreeGraph,
  listWorktrees,
  listWorktreesSharedStrictAllowingTrueEmpty
} from '../../git/worktrees/catalog/worktree-scan-cache'
import { listWorktreesStrict } from '../../git/worktrees/catalog/worktree-listing'
import { isFolderRepo } from '../../../shared/repository/repo-kind'
import {
  getRepoExecutionHostId,
  getRepoRoutingConnectionId,
  isRepoOnCatalogHost
} from '../../../shared/execution-host/execution-host'
import { resolveGitRouteForHost } from '../../providers/execution-host-provider-dispatch'
import { getSshGitProvider } from '../../providers/ssh-git-dispatch'
import {
  getSshProviderAuthority,
  isCurrentSshProviderAuthority
} from '../../ssh/connection/authority/ssh-provider-authority'
import { areWorktreePathsEqual } from '../../git/worktrees/catalog/worktree-path-comparison'
import { WorktreeCatalogUnavailableError } from '../../../shared/worktree/catalog/worktree-catalog-availability'

type LocalRepoWorktreeListOptions = {
  wslDistro?: string
  signal?: AbortSignal
}

function hasLocalRepoWorktreeListOptions(options: LocalRepoWorktreeListOptions | undefined) {
  return options?.wslDistro !== undefined || options?.signal !== undefined
}

export function isRepoRoot(repos: Repo[], resolvedTarget: string): boolean {
  return repos.some(
    (repo) => isRepoOnCatalogHost(repo) && areWorktreePathsEqual(repo.path, resolvedTarget)
  )
}

export function createFolderWorktree(repo: Repo): GitWorktreeInfo {
  return {
    path: repo.path,
    head: '',
    branch: '',
    isBare: false,
    // Folder workspaces use the folder itself as their sole primary worktree.
    isMainWorktree: true
  }
}

export async function listRepoWorktrees(
  repo: Repo,
  options?: LocalRepoWorktreeListOptions
): Promise<GitWorktreeInfo[]> {
  return listRoutedRepoWorktrees(repo, options, listWorktrees)
}

// A failed scan must reject: an authoritative empty list would prune live worktrees.
export async function listRepoWorktreesForDetectedScan(
  repo: Repo,
  options?: LocalRepoWorktreeListOptions
): Promise<GitWorktreeInfo[]> {
  return listRoutedRepoWorktrees(repo, options, listWorktreesSharedStrictAllowingTrueEmpty)
}

async function listRoutedRepoWorktrees(
  repo: Repo,
  options: LocalRepoWorktreeListOptions | undefined,
  listLocal: (
    repoPath: string,
    options?: LocalRepoWorktreeListOptions
  ) => Promise<GitWorktreeInfo[]>
): Promise<GitWorktreeInfo[]> {
  if (isFolderRepo(repo)) {
    return [createFolderWorktree(repo)]
  }
  const route = resolveGitRouteForHost(getRepoExecutionHostId(repo))
  if (
    route.kind === 'runtime' ||
    (route.kind === 'local' && !isRepoOnCatalogHost(repo)) ||
    (route.kind === 'ssh' && getRepoRoutingConnectionId(repo) !== route.connectionId)
  ) {
    throw new WorktreeCatalogUnavailableError(
      `Worktree catalog unavailable for ${repo.path}: host ${route.hostId} is not reachable from this process.`
    )
  }
  if (route.kind === 'ssh') {
    options?.signal?.throwIfAborted()
    const provider = getSshGitProvider(route.connectionId)
    const sshConnection = `Worktree catalog unavailable for ${repo.path}: SSH connection "${route.connectionId}"`
    if (!provider) {
      throw new WorktreeCatalogUnavailableError(`${sshConnection} is not connected.`)
    }
    const authority = getSshProviderAuthority(route.connectionId)
    const worktrees = await provider.listWorktrees(repo.path, { signal: options?.signal })
    options?.signal?.throwIfAborted()
    if (
      getSshGitProvider(route.connectionId) !== provider ||
      !isCurrentSshProviderAuthority(authority)
    ) {
      throw new WorktreeCatalogUnavailableError(`${sshConnection} changed during listing.`)
    }
    return worktrees
  }
  const worktrees = hasLocalRepoWorktreeListOptions(options)
    ? await listLocal(repo.path, options)
    : await listLocal(repo.path)
  return preserveFolderUpgradeWorktreePath(repo, worktrees)
}

// Path-only callers skip the expensive per-worktree sparse-checkout probe.
export async function listRepoWorktreeGraph(
  repo: Repo,
  options?: LocalRepoWorktreeListOptions
): Promise<GitWorktreeInfo[]> {
  return listRoutedRepoWorktrees(repo, options, listWorktreeGraph)
}

export async function listLocalRepoWorktreesStrict(
  repo: Repo,
  options?: LocalRepoWorktreeListOptions
): Promise<GitWorktreeInfo[]> {
  if (!isRepoOnCatalogHost(repo)) {
    throw new Error('Cannot list worktrees for a remote repository')
  }
  if (isFolderRepo(repo)) {
    return [createFolderWorktree(repo)]
  }
  const worktrees = hasLocalRepoWorktreeListOptions(options)
    ? await listWorktreesStrict(repo.path, options)
    : await listWorktreesStrict(repo.path)
  return preserveFolderUpgradeWorktreePath(repo, worktrees)
}
