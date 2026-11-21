import { windowsLongPathGitArgs } from '../../git/compatibility/windows-long-path-git-args'
import { retryOnGitLockContention } from '../../git/commands/git-lock-contention'
import { parseGitRevListAheadBehindCounts } from '../../git/refs/git-rev-list-output'
import { isShowRefNoMatchError } from '../../git/refs/git-show-ref-no-match'
import type { LocalBaseRefRefreshResult } from './base-ref-drift-types'
import {
  classifyOwnerFastForwardFailure,
  ownerFastForwardArgs
} from './local-base-branch-owner-merge'
export {
  parseLocalBaseBranchFastForwardOutcome,
  readFastForwardableBehindCount,
  toLocalBaseRefRefreshResult
} from './local-base-branch-outcome'

/** Share one policy across local/WSL main and SSH relay. exec rejects nonzero exits with Git output attached. */
export type LocalBaseBranchGit = {
  exec: (args: string[], cwd: string) => Promise<{ stdout: string }>
  /** Each worktree's path and checked-out branch as a full ref, as this host reports them. */
  listWorktrees: (repoPath: string) => Promise<readonly { path: string; branch?: string | null }[]>
  /** Full refs a rebase or bisect in any worktree has reserved; their worktrees list a detached HEAD. */
  listReservedBranches: (repoPath: string) => Promise<ReadonlySet<string>>
  /** Runs `update-ref args` unless the branch is in use, rechecked once admitted, just before Git starts; false when skipped. */
  updateRefUnlessInUse: (repoPath: string, fullRef: string, args: string[]) => Promise<boolean>
}

export type LocalBaseBranchRefs = {
  repoPath: string
  /** `refs/heads/<branch>` */
  fullRef: string
  /** `refs/remotes/<remote>/<branch>` */
  remoteTrackingRef: string
}

type LocalBaseRefRefreshStatus = LocalBaseRefRefreshResult['status']

export type LocalBaseBranchInspection =
  /** Nothing Orca may move: local matches, does not exist yet (#15331), or its checkout or a rebase/bisect owns it. */
  | { status: 'nothing_to_do' }
  | {
      status: 'behind'
      behind: number
      localOid: string
      remoteOid: string
      /** Set when a worktree has the branch checked out; only that checkout may move it. */
      ownerWorktreePath?: string
    }
  | {
      status: Exclude<LocalBaseRefRefreshStatus, 'updated'>
      ownerWorktreePath?: string
      shallowHistory?: true
    }

export type LocalBaseBranchFastForwardOutcome =
  | { status: 'nothing_to_do' }
  | { status: LocalBaseRefRefreshStatus; ownerWorktreePath?: string; shallowHistory?: true }

/** Read-only inspection of local drift. A checked-out branch is reported only when strictly behind, so its checkout stays silent otherwise; `skipCheckedOut` stops before walking its history. */
export async function inspectLocalBaseBranch(
  git: LocalBaseBranchGit,
  refs: LocalBaseBranchRefs,
  {
    skipCheckedOut = false,
    reportCheckedOutBlockers = false
  }: { skipCheckedOut?: boolean; reportCheckedOutBlockers?: boolean } = {}
): Promise<LocalBaseBranchInspection> {
  const { repoPath, fullRef, remoteTrackingRef } = refs
  let localOid: string
  let remoteOid: string
  try {
    localOid = await revParseCommit(git, repoPath, fullRef)
    remoteOid = await revParseCommit(git, repoPath, remoteTrackingRef)
    if (localOid === remoteOid) {
      return { status: 'nothing_to_do' }
    }
  } catch {
    // Only proven branch absence suppresses the warning; repo/transport failure cannot (#15331).
    return (await isRefProvenAbsent(git, repoPath, fullRef))
      ? { status: 'nothing_to_do' }
      : { status: 'skipped_not_fast_forward' }
  }

  let owner: { path: string } | undefined
  try {
    // Git's in-use rule also counts a branch a rebase or bisect has reserved.
    if ((await git.listReservedBranches(repoPath)).has(fullRef)) {
      return { status: 'nothing_to_do' }
    }
    owner = (await git.listWorktrees(repoPath)).find((wt) => wt.branch === fullRef)
  } catch {
    return { status: 'skipped_error' }
  }
  if (owner && skipCheckedOut) {
    return { status: 'nothing_to_do' }
  }
  const ownerPath = owner ? { ownerWorktreePath: owner.path } : {}

  let counts: ReturnType<typeof parseGitRevListAheadBehindCounts>
  try {
    const { stdout } = await git.exec(
      ['rev-list', '--left-right', '--count', `${localOid}...${remoteOid}`],
      repoPath
    )
    counts = parseGitRevListAheadBehindCounts(stdout)
  } catch {
    return owner && !reportCheckedOutBlockers
      ? { status: 'nothing_to_do' }
      : { status: 'skipped_not_fast_forward' }
  }
  if (counts.status === 'ok' && counts.ahead === 0 && counts.behind > 0) {
    if (owner && reportCheckedOutBlockers) {
      try {
        if (await hasTrackedChanges(git, owner.path)) {
          return { status: 'skipped_dirty_worktree', ...ownerPath }
        }
      } catch {
        return { status: 'skipped_error', ...ownerPath }
      }
    }
    return { status: 'behind', behind: counts.behind, localOid, remoteOid, ...ownerPath }
  }
  if (owner && !reportCheckedOutBlockers) {
    return { status: 'nothing_to_do' }
  }
  return (await isHistoryCutByShallowClone(git, repoPath, localOid, remoteOid))
    ? { status: 'skipped_not_fast_forward', shallowHistory: true }
    : { status: 'skipped_not_fast_forward' }
}

/** A free branch moves by compare-and-swap; a checkout can move only through its guarded fast-forward merge. */
export async function fastForwardLocalBaseBranch(
  git: LocalBaseBranchGit,
  refs: LocalBaseBranchRefs,
  { updateCheckedOut = false }: { updateCheckedOut?: boolean } = {}
): Promise<LocalBaseBranchFastForwardOutcome> {
  // Main leaves checked-out branches to its post-create update; the relay owns the legacy synchronous route.
  const inspection = await inspectLocalBaseBranch(git, refs, {
    skipCheckedOut: !updateCheckedOut,
    reportCheckedOutBlockers: updateCheckedOut
  })
  if (inspection.status !== 'behind') {
    return inspection
  }
  if (inspection.ownerWorktreePath) {
    return fastForwardOwningWorktree(
      git,
      refs,
      inspection.ownerWorktreePath,
      inspection.remoteOid,
      true
    )
  }
  const { repoPath, fullRef, remoteTrackingRef } = refs
  const { localOid, remoteOid } = inspection
  try {
    // A checkout made after the last check would be stranded, so the check runs right before the write.
    const moved = await retryOnGitLockContention(() =>
      git.updateRefUnlessInUse(repoPath, fullRef, [
        'update-ref',
        '-m',
        `orca: fast-forward to ${remoteTrackingRef}`,
        fullRef,
        remoteOid,
        localOid
      ])
    )
    return moved ? { status: 'updated' } : { status: 'nothing_to_do' }
  } catch {
    // A concurrent pull/Orca update may already have moved local; a user commit leaves it diverged.
    try {
      if (await isAncestor(git, repoPath, remoteOid, fullRef)) {
        return { status: 'updated' }
      }
      if (!(await isAncestor(git, repoPath, fullRef, remoteOid))) {
        return { status: 'skipped_not_fast_forward' }
      }
    } catch {
      // Git could not answer; report the failure itself.
    }
    return { status: 'skipped_error' }
  }
}

/** Fast-forward a checked-out branch in its own checkout when it has no tracked changes; Git refuses a held index.lock, overwritten untracked files and dropped commits. Silent; never rejects. */
export async function fastForwardCheckedOutLocalBaseBranch(
  git: LocalBaseBranchGit,
  refs: LocalBaseBranchRefs
): Promise<void> {
  const inspection = await inspectLocalBaseBranch(git, refs)
  if (inspection.status !== 'behind' || !inspection.ownerWorktreePath) {
    return
  }
  await fastForwardOwningWorktree(
    git,
    refs,
    inspection.ownerWorktreePath,
    inspection.remoteOid,
    false
  )
}

async function fastForwardOwningWorktree(
  git: LocalBaseBranchGit,
  { repoPath, fullRef }: LocalBaseBranchRefs,
  ownerWorktreePath: string,
  remoteOid: string,
  verifyResult: boolean
): Promise<LocalBaseBranchFastForwardOutcome> {
  const owner = { ownerWorktreePath }
  const branch = fullRef.slice('refs/heads/'.length)
  // A name containing `=` cannot be pinned by -c branch.<name>.mergeOptions=.
  if (branch.includes('=')) {
    return { status: 'skipped_error', ...owner }
  }
  try {
    if (await hasTrackedChanges(git, ownerWorktreePath)) {
      return { status: 'skipped_dirty_worktree', ...owner }
    }
    const { stdout: head } = await git.exec(['symbolic-ref', '-q', 'HEAD'], ownerWorktreePath)
    if (head.trim() !== fullRef) {
      return { status: 'skipped_error', ...owner }
    }
    await git.exec(
      [...windowsLongPathGitArgs(ownerWorktreePath), ...ownerFastForwardArgs(branch, remoteOid)],
      ownerWorktreePath
    )
    if (verifyResult && (await revParseCommit(git, repoPath, fullRef)) !== remoteOid) {
      return { status: 'skipped_error', ...owner }
    }
    return { status: 'updated', ...owner }
  } catch (error) {
    if (verifyResult) {
      try {
        if (await isAncestor(git, repoPath, remoteOid, fullRef)) {
          return { status: 'updated', ...owner }
        }
      } catch {
        // Preserve the original failure from the attempted update.
      }
    }
    return { status: classifyOwnerFastForwardFailure(error), ...owner }
  }
}

async function hasTrackedChanges(git: LocalBaseBranchGit, worktreePath: string): Promise<boolean> {
  // Read without index.lock so inspection cannot fail the user's concurrent Git command.
  const { stdout } = await git.exec(
    ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=no'],
    worktreePath
  )
  return stdout.trim().length > 0
}

async function revParseCommit(
  git: LocalBaseBranchGit,
  repoPath: string,
  ref: string
): Promise<string> {
  const { stdout } = await git.exec(['rev-parse', '--verify', `${ref}^{commit}`], repoPath)
  const oid = stdout.trim()
  if (!oid) {
    throw new Error(`${ref} did not resolve to a commit`)
  }
  return oid
}

// Shallow boundaries make older commits look ahead; require a missing merge base to distinguish that from divergence.
async function isHistoryCutByShallowClone(
  git: LocalBaseBranchGit,
  repoPath: string,
  localOid: string,
  remoteOid: string
): Promise<boolean> {
  try {
    const { stdout } = await git.exec(['rev-parse', '--is-shallow-repository'], repoPath)
    if (stdout.trim() !== 'true') {
      return false
    }
  } catch {
    return false
  }
  try {
    await git.exec(['merge-base', localOid, remoteOid], repoPath)
    return false
  } catch (error) {
    // merge-base reports no common ancestor like show-ref reports no ref: exit 1, silent stderr.
    return isShowRefNoMatchError(error)
  }
}

async function isRefProvenAbsent(
  git: LocalBaseBranchGit,
  repoPath: string,
  fullRef: string
): Promise<boolean> {
  try {
    await git.exec(['show-ref', '--verify', '--quiet', '--', fullRef], repoPath)
    return false
  } catch (error) {
    return isShowRefNoMatchError(error)
  }
}

async function isAncestor(
  git: LocalBaseBranchGit,
  repoPath: string,
  ancestor: string,
  descendant: string
): Promise<boolean> {
  try {
    await git.exec(['merge-base', '--is-ancestor', ancestor, descendant], repoPath)
    return true
  } catch (error) {
    // Only Git's silent exit 1 means "not an ancestor"; anything else is a failure to answer.
    if (isShowRefNoMatchError(error)) {
      return false
    }
    throw error
  }
}
