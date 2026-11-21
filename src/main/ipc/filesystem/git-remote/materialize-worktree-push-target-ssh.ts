import {
  getRepoExecutionHostId,
  toSshExecutionHostId
} from '../../../../shared/execution-host/execution-host'
import { assertValidGitPushTarget } from '../../../../shared/git/remotes/git-push-target-validation'
import type { HostWorktreeTarget } from '../../../../shared/worktree/host-qualified-identity'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree/id'
import type { GitPushTarget } from '../../../../shared/worktree/types'
import { forkRemoteTrackingRefExists } from '../../../git/refs/fork-remotes/fork-remote-refspec'
import {
  sameGitHubRemoteUrl,
  type GitRemoteExec,
  type WorktreePushTargetStore
} from '../../../git/remotes/worktree-push-target-cleanup'
import {
  ensureUniqueRemoteName,
  findRemoteForUrl,
  remoteAlreadyMatchesUrl,
  restoreUpstreamAfterMaterialize
} from '../../../git/remotes/worktree-push-target-setup'
import { readAllWorktreeMetaForHost } from '../../../persistence/host-qualified-worktree-meta'
import type { SshGitProvider } from '../../../providers/ssh-git-provider'

const pendingRemoteSetup = new WeakMap<SshGitProvider, Map<string, Promise<GitPushTarget>>>()

function persistedRemoteOwner(
  provider: SshGitProvider,
  store: WorktreePushTargetStore,
  worktree: HostWorktreeTarget | undefined
) {
  if (!worktree || worktree.hostId !== toSshExecutionHostId(provider.getConnectionId())) {
    return undefined
  }
  const repoId = getRepoIdFromWorktreeId(worktree.id)
  const repos = store.getRepos?.()
  if (
    repos &&
    !repos.some((repo) => repo.id === repoId && getRepoExecutionHostId(repo) === worktree.hostId)
  ) {
    return undefined
  }
  return { worktree, repoId }
}

async function prepareSshForkRemote(
  provider: SshGitProvider,
  repoPath: string,
  target: GitPushTarget & { remoteUrl: string },
  store: WorktreePushTargetStore,
  worktree: HostWorktreeTarget | undefined
): Promise<GitPushTarget> {
  const execGit: GitRemoteExec = (args, cwd) => provider.exec(args, cwd)
  await provider.exec(['check-ref-format', '--branch', target.branchName], repoPath)
  const reusedRemote = (await remoteAlreadyMatchesUrl(
    execGit,
    repoPath,
    target.remoteName,
    target.remoteUrl
  ))
    ? target.remoteName
    : await findRemoteForUrl(execGit, repoPath, target.remoteUrl)
  const remoteName =
    reusedRemote ?? (await ensureUniqueRemoteName(execGit, repoPath, target.remoteName))
  if (!reusedRemote) {
    try {
      await provider.exec(['remote', 'add', remoteName, target.remoteUrl], repoPath)
    } catch (error) {
      if (error instanceof Error && error.message.includes('Destructive git remote operations')) {
        throw new Error(
          'This SSH host cannot add a fork remote. Reconnect to deploy the latest Orca relay.'
        )
      }
      throw error
    }
  }
  let prepared: GitPushTarget
  try {
    if (!reusedRemote) {
      await provider.markRemoteOrcaCreated(repoPath, remoteName)
    }
    if (
      !reusedRemote ||
      !(await forkRemoteTrackingRefExists(execGit, repoPath, remoteName, target.branchName))
    ) {
      await provider.fetchRemoteTrackingRef(
        repoPath,
        remoteName,
        target.branchName,
        `refs/remotes/${remoteName}/${target.branchName}`
      )
    }
    prepared = await restoreUpstreamAfterMaterialize(execGit, repoPath, { ...target, remoteName })
  } catch (error) {
    if (!reusedRemote) {
      await provider.exec(['remote', 'remove', remoteName], repoPath).catch(() => {})
    }
    throw error
  }
  const owner = persistedRemoteOwner(provider, store, worktree)
  const remoteCreated =
    !reusedRemote ||
    (owner &&
      Object.entries(readAllWorktreeMetaForHost(store, owner.worktree.hostId)).some(
        ([id, meta]) => {
          const pushTarget = meta.pushTarget
          return (
            getRepoIdFromWorktreeId(id) === owner.repoId &&
            pushTarget?.remoteCreated === true &&
            (pushTarget.remoteName === remoteName ||
              (!!pushTarget.remoteUrl &&
                sameGitHubRemoteUrl(pushTarget.remoteUrl, target.remoteUrl)))
          )
        }
      ))
  if (remoteCreated) {
    prepared = { ...prepared, remoteCreated: true }
    if (owner) {
      store.setWorktreeMeta?.(owner.worktree, { pushTarget: prepared })
    }
  }
  return prepared
}

export async function materializeWorktreePushTargetRemoteSsh(
  provider: SshGitProvider,
  repoPath: string,
  target: GitPushTarget,
  store: WorktreePushTargetStore,
  worktree: HostWorktreeTarget | undefined
): Promise<GitPushTarget> {
  assertValidGitPushTarget(target)
  if (!target.remoteUrl || target.remoteCreated) {
    return target
  }
  const scoped = { ...target, remoteUrl: target.remoteUrl }
  const key = JSON.stringify([repoPath, target.remoteName])
  let pending = pendingRemoteSetup.get(provider)
  if (!pending) {
    pending = new Map()
    pendingRemoteSetup.set(provider, pending)
  }
  // Create the remote once. Each caller still needs its own branch’s upstream restored.
  const setup = (pending.get(key) ?? Promise.resolve()).then(() =>
    prepareSshForkRemote(provider, repoPath, scoped, store, worktree)
  )
  pending.set(key, setup)
  try {
    return await setup
  } finally {
    if (pending.get(key) === setup) {
      pending.delete(key)
    }
  }
}
