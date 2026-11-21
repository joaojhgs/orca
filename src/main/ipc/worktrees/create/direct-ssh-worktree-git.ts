import type { Repo } from '../../../../shared/repository/repo-types'
import type {
  LocalBaseRefRefreshResult,
  LocalBaseRefUpdateSuggestion
} from '../../../../shared/worktree/base-refs/base-ref-drift-types'
import { toLocalBaseRefRefreshResult } from '../../../../shared/worktree/base-refs/local-base-branch-fast-forward'
import { resolveDefaultBaseRefViaExec } from '../../../../shared/git/refs/git-default-base-ref'
import { resolveWorktreeCreateBase } from '../../../workspaces/creation/worktree-create-base'
import type { RemoteTrackingBase } from '../../../runtime/repositories/runtime-remote-fetch-controller'
import type { SshGitProvider } from '../../../providers/ssh-git-provider'
import { isSshRequestOutcomeUnverifiable } from '../../../ssh/protocol/ssh-channel-multiplexer'
import type { DirectSshWorktreeAuthority } from '../direct-ssh-worktree-authority'
import {
  fetchRemoteForWorktreeCreate,
  refreshRemoteTrackingBaseForWorktreeCreate,
  sshProviderKey
} from './direct-ssh-worktree-fetch'
import { hasCommitRefSsh, hasRemoteWorktreeBaseRef } from './direct-ssh-worktree-refs'

type RemoteWorktreeCreateBasePlan = {
  baseBranch: string
  remoteTrackingBase: RemoteTrackingBase | null
}
const sshWorktreeCreateBasePlanInflight = new Map<
  string,
  Promise<RemoteWorktreeCreateBasePlan | null>
>()
function getSshWorktreeCreateBasePlanKey(
  provider: SshGitProvider,
  repo: Repo,
  requestedBaseBranch: string | undefined
): string {
  const baseKey = requestedBaseBranch || repo.worktreeBaseRef || 'default'
  return `${sshProviderKey(provider)}::${repo.path}::plan:${baseKey}`
}

async function resolveRemoteTrackingBaseSsh(
  provider: SshGitProvider,
  repoPath: string,
  baseBranch: string
): Promise<RemoteTrackingBase | null> {
  if (baseBranch.startsWith('refs/') && !baseBranch.startsWith('refs/remotes/')) {
    return null
  }
  let remotes: string[]
  try {
    const { stdout } = await provider.exec(['remote'], repoPath)
    remotes = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return null
  }

  const remoteRefPrefix = 'refs/remotes/'
  const shortBaseBranch = baseBranch.startsWith(remoteRefPrefix)
    ? baseBranch.slice(remoteRefPrefix.length)
    : baseBranch
  const remote = remotes
    .filter((candidate) => shortBaseBranch.startsWith(`${candidate}/`))
    .sort((a, b) => b.length - a.length)[0]
  if (!remote) {
    return null
  }
  const branch = shortBaseBranch.slice(remote.length + 1)
  if (!branch) {
    return null
  }
  return {
    remote,
    branch,
    ref: `refs/remotes/${remote}/${branch}`,
    base: `${remote}/${branch}`
  }
}

async function resolveRemoteWorktreeCreateBasePlan(
  provider: SshGitProvider,
  repo: Repo,
  requestedBaseBranch: string | undefined
): Promise<RemoteWorktreeCreateBasePlan | null> {
  const baseBranch = await resolveWorktreeCreateBase({
    requestedBaseBranch,
    repoWorktreeBaseRef: repo.worktreeBaseRef,
    resolveDefaultBaseRef: () =>
      resolveDefaultBaseRefViaExec((argv) => provider.exec(argv, repo.path)),
    isBaseUsable: async (baseBranchCandidate) => {
      const remoteTrackingBase = await resolveRemoteTrackingBaseSsh(
        provider,
        repo.path,
        baseBranchCandidate
      )
      if (remoteTrackingBase) {
        if (await hasCommitRefSsh(provider, repo.path, remoteTrackingBase.ref)) {
          return true
        }
        return hasRemoteWorktreeBaseRef(provider, repo.path, baseBranchCandidate)
      }
      return hasRemoteWorktreeBaseRef(provider, repo.path, baseBranchCandidate)
    }
  })
  if (!baseBranch) {
    return null
  }
  return {
    baseBranch,
    remoteTrackingBase: await resolveRemoteTrackingBaseSsh(provider, repo.path, baseBranch)
  }
}

export function getOrStartRemoteWorktreeCreateBasePlan(
  provider: SshGitProvider,
  repo: Repo,
  requestedBaseBranch: string | undefined
): Promise<RemoteWorktreeCreateBasePlan | null> {
  const key = getSshWorktreeCreateBasePlanKey(provider, repo, requestedBaseBranch)
  const existing = sshWorktreeCreateBasePlanInflight.get(key)
  if (existing) {
    return existing
  }
  const promise = resolveRemoteWorktreeCreateBasePlan(provider, repo, requestedBaseBranch).finally(
    () => {
      if (sshWorktreeCreateBasePlanInflight.get(key) === promise) {
        sshWorktreeCreateBasePlanInflight.delete(key)
      }
    }
  )
  sshWorktreeCreateBasePlanInflight.set(key, promise)
  return promise
}

export async function prefetchRemoteWorktreeCreateBase(
  ssh: DirectSshWorktreeAuthority,
  repo: Repo,
  args: { baseBranch?: string }
): Promise<void> {
  const { provider } = ssh
  await ssh.registerRoot(repo.path)
  const basePlan = await getOrStartRemoteWorktreeCreateBasePlan(provider, repo, args.baseBranch)
  if (!basePlan) {
    return
  }
  if (basePlan.remoteTrackingBase) {
    if (
      (await hasCommitRefSsh(provider, repo.path, basePlan.remoteTrackingBase.ref)) ||
      !(await hasRemoteWorktreeBaseRef(provider, repo.path, basePlan.baseBranch))
    ) {
      ssh.assertCurrent()
      await refreshRemoteTrackingBaseForWorktreeCreate(provider, repo, basePlan.remoteTrackingBase)
      return
    }
  }
  if (await hasRemoteWorktreeBaseRef(provider, repo.path, basePlan.baseBranch)) {
    // Why: PR/MR resolvers already fetched verified SHA start points; a broad fetch only updates unrelated refs.
    return
  }

  // Why: mirrors createRemoteWorktree's legacy local-base fallback so prefetch and create share one process-local SSH fetch cache.
  ssh.assertCurrent()
  await fetchRemoteForWorktreeCreate(provider, repo, basePlan.baseBranch)
}

/** Never rejects: the create may already have succeeded when this settles. */
export async function refreshLocalBaseRefForRemoteWorktreeCreate(
  provider: SshGitProvider,
  repoPath: string,
  remoteTrackingBase: RemoteTrackingBase
): Promise<LocalBaseRefRefreshResult | undefined> {
  const names = { baseRef: remoteTrackingBase.base, localBranch: remoteTrackingBase.branch }
  try {
    // Why: the relay owns the whole refresh on the execution host, one run per branch at a time.
    const outcome = await provider.refreshLocalBaseRefForWorktreeCreate({
      repoPath,
      fullRef: `refs/heads/${remoteTrackingBase.branch}`,
      remoteTrackingRef: remoteTrackingBase.ref
    })
    return toLocalBaseRefRefreshResult(names, outcome)
  } catch (error) {
    if (isSshRequestOutcomeUnverifiable(error)) {
      // Why: the host may still finish it; claiming it failed would be a guess.
      console.warn('[worktree-create] local base ref refresh outcome unknown', error)
      return undefined
    }
    return toLocalBaseRefRefreshResult(names, { status: 'skipped_error' })
  }
}

export async function getRemoteLocalBaseRefUpdateSuggestionForWorktreeCreate(
  provider: SshGitProvider,
  repoPath: string,
  remoteTrackingBase: RemoteTrackingBase
): Promise<LocalBaseRefUpdateSuggestion | undefined> {
  try {
    const behind = await provider.getLocalBaseRefFastForwardableBehind({
      repoPath,
      fullRef: `refs/heads/${remoteTrackingBase.branch}`,
      remoteTrackingRef: remoteTrackingBase.ref
    })
    return behind === undefined
      ? undefined
      : { baseRef: remoteTrackingBase.base, localBranch: remoteTrackingBase.branch, behind }
  } catch {
    return undefined
  }
}
