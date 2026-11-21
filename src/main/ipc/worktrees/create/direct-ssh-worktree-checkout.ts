import type { Store } from '../../../persistence/loading-store/store'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { LocalBaseRefRefreshResult } from '../../../../shared/worktree/base-refs/base-ref-drift-types'
import type { IFilesystemProvider } from '../../../providers/types'
import { retireGeneratedWorktreeName } from '../../../workspaces/removal/retirement/worktree-name-retirement'
import type { WorktreeCreateTimingRecorder } from '../../../workspaces/creation/worktree-create-timing'
import { shouldRunSetupForCreate } from '../../../workspace-hooks/effective-hook-config'
import { findCreatedWorktree } from '../creation/created-worktree-reconciliation'
import { runWorktreeChangeInvalidators } from '../listing/worktree-change-invalidators'
import { readDirectSshHooks } from '../removal/direct-ssh-archive-hooks'
import type { DirectSshWorktreeAuthority } from '../direct-ssh-worktree-authority'
import type { CreateWorktreeArgsWithSystemProvenance } from '../worktree-remote'
import {
  getRemoteLocalBaseRefUpdateSuggestionForWorktreeCreate,
  refreshLocalBaseRefForRemoteWorktreeCreate
} from './direct-ssh-worktree-git'
import {
  fetchRemoteForWorktreeCreate,
  refreshRemoteTrackingBaseForWorktreeCreate
} from './direct-ssh-worktree-fetch'
import {
  hasCommitRefSsh,
  hasRemoteWorktreeBaseRef,
  unsetRemoteWorktreeCreationBase
} from './direct-ssh-worktree-refs'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import type { DirectSshWorktreeCreatePlan } from './direct-ssh-worktree-plan'

export async function checkoutDirectSshWorktree({
  args,
  repo,
  store,
  settings,
  ssh,
  fsProvider,
  timing,
  assertCurrent,
  plan,
  sparseDirectories
}: {
  args: CreateWorktreeArgsWithSystemProvenance
  repo: Repo
  store: Store
  settings: GlobalSettings
  ssh: DirectSshWorktreeAuthority
  fsProvider: IFilesystemProvider | undefined
  timing: WorktreeCreateTimingRecorder
  assertCurrent: () => void
  plan: DirectSshWorktreeCreatePlan
  sparseDirectories: string[]
}) {
  const { provider } = ssh
  const {
    branchName,
    checkoutExistingBranch,
    remotePath,
    effectiveSanitizedName,
    shouldRetireGeneratedName
  } = plan
  let { baseBranch, remoteTrackingBase } = plan

  // Why: addWorktree/setup probes run inside the new path; older relays need that root registered before accepting git/fs ops there.
  await ssh.registerRoot(remotePath)

  assertCurrent()
  if (remoteTrackingBase) {
    try {
      await refreshRemoteTrackingBaseForWorktreeCreate(provider, repo, remoteTrackingBase)
    } catch {
      // Why: a refresh failure shouldn't block create if a usable (stale) local base ref exists; probe after registerRoot and hard-fail only when none does.
      if (!(await hasCommitRefSsh(provider, repo.path, remoteTrackingBase.ref))) {
        throw new Error(
          `Could not refresh base ref "${baseBranch}" from "${remoteTrackingBase.remote}". Check your network and try again.`
        )
      }
    }
  } else if (!(await hasRemoteWorktreeBaseRef(provider, repo.path, baseBranch))) {
    // Why: fetch only the missing named base; verified PR/MR SHA bases already have the object.
    try {
      const fetchedBase = await fetchRemoteForWorktreeCreate(provider, repo, baseBranch)
      if (await hasCommitRefSsh(provider, repo.path, fetchedBase.ref)) {
        baseBranch = fetchedBase.base
        remoteTrackingBase = fetchedBase
      }
    } catch {
      /* best-effort */
    }
  }

  // Why: started, not awaited — the relay adds from the remote-tracking ref, so the refresh overlaps the checkout.
  // A create of the base's own local branch is skipped: `-b` proves it did not exist, and probing it would race the add.
  const pendingLocalBaseRefRefresh =
    settings.refreshLocalBaseRefOnWorktreeCreate &&
    !checkoutExistingBranch &&
    remoteTrackingBase &&
    remoteTrackingBase.branch !== branchName
      ? refreshLocalBaseRefForRemoteWorktreeCreate(provider, repo.path, remoteTrackingBase)
      : undefined
  const localBaseRefUpdateSuggestion =
    !settings.refreshLocalBaseRefOnWorktreeCreate &&
    !settings.localBaseRefSuggestionDismissed &&
    !checkoutExistingBranch &&
    remoteTrackingBase
      ? await getRemoteLocalBaseRefUpdateSuggestionForWorktreeCreate(
          provider,
          repo.path,
          remoteTrackingBase
        )
      : undefined

  if (fsProvider) {
    const primaryHooks = await readDirectSshHooks(repo, fsProvider)
    if (primaryHooks?.scripts.setup) {
      shouldRunSetupForCreate(repo, args.setupDecision)
    }
  }

  let localBaseRefRefresh: LocalBaseRefRefreshResult | undefined
  try {
    assertCurrent()
    await timing.time('git_worktree_add', async () =>
      provider.addWorktree(
        repo.path,
        branchName,
        remotePath,
        checkoutExistingBranch
          ? { checkoutExistingBranch }
          : { base: baseBranch, ...(sparseDirectories.length > 0 ? { noCheckout: true } : {}) }
      )
    )
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('No workspace roots registered yet') ||
        err.message.includes('Path outside authorized workspace'))
    ) {
      // Why: only OLD relays (pre-allowlist-removal) throw these; surface an upgrade message. Remove after version floor moves (docs/relay-fs-allowlist-removal.md).
      throw new Error(
        `Older relay reported an authorization error; please reconnect to deploy the latest relay. (${err.message})`,
        { cause: err }
      )
    }
    throw err
  } finally {
    // Why: a sparse rollback below must not race a refresh still moving the owner checkout.
    localBaseRefRefresh = await pendingLocalBaseRefRefresh
  }
  // Why: the worktree is listable from here on; a scan that began before it appeared is overtaken.
  runWorktreeChangeInvalidators(repo.id)
  assertCurrent()
  if (sparseDirectories.length > 0) {
    try {
      // Why: SSH providers expose generic git exec, so remote sparse mirrors local addSparseWorktree without a new relay method.
      await provider.exec(['sparse-checkout', 'init', '--cone'], remotePath)
      assertCurrent()
      await provider.exec(['sparse-checkout', 'set', '--', ...sparseDirectories], remotePath)
      assertCurrent()
      await provider.exec(['checkout', branchName], remotePath)
    } catch (err) {
      assertCurrent()
      let rollbackSucceeded = false
      if (!checkoutExistingBranch) {
        try {
          await unsetRemoteWorktreeCreationBase(provider, remotePath, branchName)
        } catch (cleanupError) {
          console.warn(
            '[worktree-create] Failed to clear remote sparse creation base:',
            cleanupError
          )
        }
      }
      try {
        await provider.removeWorktree(remotePath, true, {
          deleteBranch: !checkoutExistingBranch,
          // Why: sparse setup failed before any work happened, so rollback removes the just-created remote branch.
          forceBranchDelete: !checkoutExistingBranch
        })
        rollbackSucceeded = true
      } catch (rollbackError) {
        console.warn('[worktree-create] Failed to roll back remote sparse worktree:', rollbackError)
      }
      if (!rollbackSucceeded && shouldRetireGeneratedName) {
        await retireGeneratedWorktreeName(store, repo, settings, effectiveSanitizedName)
      }
      throw err
    }
  }

  // Why: fallible metadata work after creation must not leave a real workspace name reusable.
  if (shouldRetireGeneratedName) {
    await retireGeneratedWorktreeName(store, repo, settings, effectiveSanitizedName)
  }

  // Re-list to get the created worktree info
  const gitWorktrees = await timing.time('list_created_worktree', async () =>
    provider.listWorktrees(repo.path)
  )
  timing.recordWorktreeCount(gitWorktrees.length)
  // Match the exact requested path first, then the exact branch ref. Suffix matching can
  // select an older `prefix/<branchName>` worktree when the newly created row is present.
  const created = findCreatedWorktree(gitWorktrees, remotePath, branchName)
  if (!created) {
    throw new Error('Worktree created but not found in listing')
  }

  assertCurrent()
  // Why: PR/MR worktrees start from a head ref/SHA but Source Control must compare against the review target branch.
  const metadataBaseRef = args.compareBaseRef ?? remoteTrackingBase?.ref ?? baseBranch

  return { created, metadataBaseRef, localBaseRefRefresh, localBaseRefUpdateSuggestion }
}
