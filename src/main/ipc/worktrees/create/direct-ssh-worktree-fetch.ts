import type { Repo } from '../../../../shared/repository/repo-types'
import type { RemoteTrackingBase } from '../../../runtime/repositories/runtime-remote-fetch-controller'
import type { SshGitProvider } from '../../../providers/ssh-git-provider'
import { normalizeLocalBranchName } from './direct-ssh-worktree-refs'

const SSH_WORKTREE_CREATE_FETCH_FRESHNESS_MS = 30_000
const SSH_WORKTREE_CREATE_FETCH_CACHE_MAX = 512
const sshWorktreeCreateFetchInflight = new Map<string, Promise<void>>()
const sshWorktreeCreateFetchCompletedAt = new Map<string, number>()
const sshWorktreeCreateFetchQueueTail = new Map<string, Promise<void>>()
const providerKeys = new WeakMap<SshGitProvider, number>()
let nextProviderKey = 0

export function sshProviderKey(provider: SshGitProvider): number {
  const key = providerKeys.get(provider)
  if (key !== undefined) {
    return key
  }
  const next = ++nextProviderKey
  providerKeys.set(provider, next)
  return next
}

function setBoundedSshWorktreeCreateFetchEntry(
  map: Map<string, number>,
  key: string,
  value: number
): void {
  if (map.has(key)) {
    map.delete(key)
  }
  map.set(key, value)
  while (map.size > SSH_WORKTREE_CREATE_FETCH_CACHE_MAX) {
    const oldest = map.keys().next()
    if (oldest.done) {
      return
    }
    map.delete(oldest.value)
  }
}

function getSshWorktreeCreateBaseFetchKey(
  provider: SshGitProvider,
  repo: Repo,
  base: RemoteTrackingBase
): string {
  return `${sshProviderKey(provider)}::${repo.path}::base:${base.remote}:${base.branch}`
}

function getSshWorktreeCreateRemoteQueueKey(
  provider: SshGitProvider,
  repo: Repo,
  remote: string
): string {
  return `${sshProviderKey(provider)}::${repo.path}::queue:${remote}`
}

function getFreshSshWorktreeCreateFetchCompletedAt(key: string): number | null {
  const lastAt = sshWorktreeCreateFetchCompletedAt.get(key)
  if (lastAt === undefined) {
    return null
  }
  if (Date.now() - lastAt < SSH_WORKTREE_CREATE_FETCH_FRESHNESS_MS) {
    setBoundedSshWorktreeCreateFetchEntry(sshWorktreeCreateFetchCompletedAt, key, lastAt)
    return lastAt
  }
  sshWorktreeCreateFetchCompletedAt.delete(key)
  return null
}

function rememberSshWorktreeCreateFetchCompletedAt(key: string): void {
  setBoundedSshWorktreeCreateFetchEntry(sshWorktreeCreateFetchCompletedAt, key, Date.now())
}

function enqueueSshWorktreeCreateFetch(
  queueKey: string,
  fetch: () => Promise<void>
): Promise<void> {
  const previous = sshWorktreeCreateFetchQueueTail.get(queueKey)
  const promise = previous ? previous.then(fetch, fetch) : fetch()
  sshWorktreeCreateFetchQueueTail.set(queueKey, promise)
  const clearQueueTail = (): void => {
    if (sshWorktreeCreateFetchQueueTail.get(queueKey) === promise) {
      sshWorktreeCreateFetchQueueTail.delete(queueKey)
    }
  }
  promise.then(clearQueueTail, clearQueueTail)
  return promise
}

async function getOrStartSshWorktreeCreateFetch(
  key: string,
  queueKey: string,
  fetch: () => Promise<void>
): Promise<void> {
  if (getFreshSshWorktreeCreateFetchCompletedAt(key) !== null) {
    return
  }
  const existing = sshWorktreeCreateFetchInflight.get(key)
  if (existing) {
    return existing
  }
  const promise = enqueueSshWorktreeCreateFetch(queueKey, async () => {
    if (getFreshSshWorktreeCreateFetchCompletedAt(key) !== null) {
      return
    }
    await fetch()
    // Why: SSH creation has no OrcaRuntimeService to share; still reuse recent fetches for repeated creates on the same target.
    rememberSshWorktreeCreateFetchCompletedAt(key)
  }).finally(() => {
    if (sshWorktreeCreateFetchInflight.get(key) === promise) {
      sshWorktreeCreateFetchInflight.delete(key)
    }
  })
  sshWorktreeCreateFetchInflight.set(key, promise)
  return promise
}

export async function refreshRemoteTrackingBaseForWorktreeCreate(
  provider: SshGitProvider,
  repo: Repo,
  base: RemoteTrackingBase
): Promise<void> {
  return getOrStartSshWorktreeCreateFetch(
    getSshWorktreeCreateBaseFetchKey(provider, repo, base),
    getSshWorktreeCreateRemoteQueueKey(provider, repo, base.remote),
    () =>
      // Why: the exact-base refresh gates create; unrelated repo housekeeping must not extend it.
      provider.fetchRemoteTrackingRef(repo.path, base.remote, base.branch, base.ref, {
        skipAutoMaintenance: true
      })
  )
}

export async function fetchRemoteForWorktreeCreate(
  provider: SshGitProvider,
  repo: Repo,
  baseBranch: string
): Promise<RemoteTrackingBase> {
  const branch = normalizeLocalBranchName(baseBranch)
  const base = {
    remote: 'origin',
    branch,
    ref: `refs/remotes/origin/${branch}`,
    base: `origin/${branch}`
  }
  await refreshRemoteTrackingBaseForWorktreeCreate(provider, repo, base)
  return base
}
