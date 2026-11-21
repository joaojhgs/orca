import type { Repo } from '../../../../shared/repository/repo-types'
import type { ExecutionHostId } from '../../../../shared/execution-host/execution-host'
import type { RemoveWorktreeResult } from '../../../../shared/worktree/create-types'
import type { GitPushTarget, GitWorktreeInfo } from '../../../../shared/worktree/types'
import type { WorktreeMeta } from '../../../../shared/worktree/meta-types'
import { assertWorktreeUnlockedForRemoval } from '../../../../shared/worktree/removal/removal'
import { gateWorktreeRemovalOnArchiveHook } from '../../../workspaces/removal/worktree-archive-hook-gate'
import {
  assertWorktreeDoesNotContainRegisteredWorktree,
  canCleanupUnregisteredOrcaWorktreeDirectory,
  canSafelyRemoveOrphanedWorktreeDirectory,
  findRegisteredDeletableWorktree,
  isWorktreePathMissing,
  ORPHANED_WORKTREE_DIRECTORY_MESSAGE,
  UNREGISTERED_MISSING_WORKTREE_MESSAGE
} from '../../../workspaces/removal/worktree-removal-safety'
import { assertNestedWorktreeRemovalApproval } from '../../../workspaces/removal/nested-worktree-removal-plan'
import { getSshFilesystemProvider } from '../../../providers/ssh-filesystem-dispatch'
import { withWorktreeRemoveStageSpan } from '../../../observability/instrumentation'
import { cleanupUnusedWorktreePushTargetRemoteWithExec } from '../../../git/remotes/worktree-push-target-cleanup'
import { readAllWorktreeMetaForHost } from '../../../persistence/host-qualified-worktree-meta'
import type { Store } from '../../../persistence/loading-store/store'
import { getSshPtyProvider } from '../../pty/provider/registry'
import { preservedBranchCleanupScopeKey } from '../../../../shared/git/branches/preserved-branch-cleanup'
import { notifyWorktreesChanged } from '../worktree-remote'
import { runWorktreeChangeInvalidators } from '../listing/worktree-change-invalidators'
import { isCapturedRepoCurrent } from '../listing/worktree-host-ownership'
import { formatWorktreeRemovalError } from '../paths/worktree-logic'
import type { DirectSshWorktreeAuthority } from '../direct-ssh-worktree-authority'
import type { RemoveWorktreeArgs } from '../ipc-context-schemas'
import type { WorktreeIpcContext } from '../worktree-ipc-context'
import {
  preserveBranchHeadFallback,
  preservedBranchCleanupByScope,
  rememberPreservedBranchCleanupTarget
} from './preserved-branch-cleanup'
import { invalidateAuthorizedRootsCache } from './registered-worktree-roots-cache'
import {
  removeWorktreeMetadataAndTransientState,
  stopPtysForDestructiveWorktreeRemoval
} from './worktree-removal-ownership'
import { runDirectSshArchiveHook, readDirectSshHooks } from './direct-ssh-archive-hooks'

export async function cleanupDirectSshWorktreePushTarget(
  ssh: DirectSshWorktreeAuthority,
  repoPath: string,
  worktreeId: string,
  target: GitPushTarget | undefined,
  store: Store,
  hostId: ExecutionHostId
): Promise<void> {
  await cleanupUnusedWorktreePushTargetRemoteWithExec(
    repoPath,
    worktreeId,
    target,
    { getAllWorktreeMeta: () => readAllWorktreeMetaForHost(store, hostId) },
    (argv, cwd) => {
      ssh.assertCurrent()
      return ssh.provider.exec(argv, cwd)
    }
  ).catch((error) => console.warn('[worktrees] Failed to clean up direct SSH push target', error))
}

export async function removeDirectSshWorktree(
  context: WorktreeIpcContext,
  args: RemoveWorktreeArgs,
  repo: Repo,
  worktreePath: string,
  hostId: ExecutionHostId,
  ssh: DirectSshWorktreeAuthority,
  meta?: WorktreeMeta
): Promise<RemoveWorktreeResult> {
  const { store, runtime, mainWindow } = context
  const assertCurrent = (): void => {
    ssh.assertCurrent()
    if (!isCapturedRepoCurrent(store, repo, hostId)) {
      throw new Error('SSH worktree repository ownership changed during removal.')
    }
  }
  assertCurrent()
  const home = ssh.removalHome()
  const list = async (): Promise<GitWorktreeInfo[]> => {
    const result = await ssh.provider.listWorktrees(repo.path)
    assertCurrent()
    return result
  }
  const worktrees = await list()
  const registered = findRegisteredDeletableWorktree(repo.path, worktreePath, worktrees, home)
  if (args.expectedCheckout) {
    assertNestedWorktreeRemovalApproval(registered ? [registered] : [], [args.expectedCheckout])
  }
  const fsProvider = getSshFilesystemProvider(ssh.connectionId)
  const deleteBranch = meta?.preserveBranchOnDelete !== true
  let result: RemoveWorktreeResult = {}
  const path = registered?.path ?? worktreePath
  let removeCheckout: (() => Promise<RemoveWorktreeResult>) | undefined
  if (registered) {
    try {
      assertWorktreeUnlockedForRemoval(registered)
    } catch (error) {
      throw new Error(formatWorktreeRemovalError(error, path, args.force ?? false))
    }
    const script = args.skipArchive
      ? undefined
      : (await readDirectSshHooks(repo, fsProvider))?.scripts.archive
    if (script) {
      assertCurrent()
      const archiveHookOverride = await withWorktreeRemoveStageSpan(
        'archive_hook',
        'remote',
        async () =>
          gateWorktreeRemovalOnArchiveHook({
            worktreePath: path,
            result: await runDirectSshArchiveHook(ssh, repo, path, script),
            allowFailure: args.allowFailedArchiveHook === true
          })
      )
      if (archiveHookOverride) {
        result.archiveHookOverride = archiveHookOverride
      }
    }
    if (args.expectedCheckout) {
      const current = findRegisteredDeletableWorktree(repo.path, path, await list(), home)
      assertNestedWorktreeRemovalApproval(current ? [current] : [], [args.expectedCheckout])
    }
    if (!args.force) {
      const { clean, stdout } = await ssh.provider.worktreeIsClean(path)
      if (!clean) {
        throw Object.assign(new Error('Worktree has uncommitted or untracked changes.'), { stdout })
      }
    }
    removeCheckout = () =>
      deleteBranch
        ? ssh.provider.removeWorktree(path, args.force)
        : ssh.provider.removeWorktree(path, args.force, { deleteBranch })
  } else {
    if (!fsProvider) {
      throw new Error('SSH filesystem provider unavailable.')
    }
    const orphaned =
      canCleanupUnregisteredOrcaWorktreeDirectory({ meta }) &&
      fsProvider.lstat &&
      fsProvider.realpath &&
      (await canSafelyRemoveOrphanedWorktreeDirectory(path, repo.path, home, {
        statPath: (file) => fsProvider.lstat!(file),
        layoutStatPath: (file) => fsProvider.stat(file),
        readPath: (file) => fsProvider.readFile(file),
        realPath: (file) => fsProvider.realpath!(file)
      }))
    if (orphaned) {
      assertWorktreeDoesNotContainRegisteredWorktree(path, worktrees)
      if (!args.force) {
        throw new Error(ORPHANED_WORKTREE_DIRECTORY_MESSAGE)
      }
      removeCheckout = async () => {
        if (getSshFilesystemProvider(ssh.connectionId) !== fsProvider) {
          throw new Error('SSH filesystem provider changed.')
        }
        await fsProvider.deletePath(path, true)
        return {}
      }
    } else if (!(await isWorktreePathMissing(path, (file) => fsProvider.stat(file)))) {
      throw new Error(`Refusing to delete unregistered worktree path: ${path}`)
    } else if (!args.force && !meta) {
      throw new Error(UNREGISTERED_MISSING_WORKTREE_MESSAGE)
    }
  }

  assertCurrent()
  if (removeCheckout) {
    const gate = await runtime.acquireFileWatcherRemoval(path, ssh.connectionId)
    let removed = false
    try {
      assertCurrent()
      await stopPtysForDestructiveWorktreeRemoval(runtime, args.worktreeId, {
        connectionId: ssh.connectionId,
        allowUnverifiedStop: args.allowUnverifiedPtyStop
      })
      assertCurrent()
      result = { ...result, ...(await removeCheckout()) }
      runWorktreeChangeInvalidators(repo.id)
      removed = true
    } finally {
      await gate.finish(removed)
    }
  }
  assertCurrent()
  try {
    await getSshPtyProvider(ssh.connectionId)?.deleteWorktreeHistory?.(args.worktreeId)
  } catch (error) {
    console.warn('[worktrees] Failed to clean up direct SSH worktree history', error)
  }
  await cleanupDirectSshWorktreePushTarget(
    ssh,
    repo.path,
    args.worktreeId,
    meta?.pushTarget,
    store,
    hostId
  )
  assertCurrent()
  if (registered) {
    result = preserveBranchHeadFallback(result, registered.head)
    rememberPreservedBranchCleanupTarget(
      args.worktreeId,
      hostId,
      result,
      registered.head,
      meta?.pushTarget
    )
  } else {
    preservedBranchCleanupByScope.delete(
      preservedBranchCleanupScopeKey({ worktreeId: args.worktreeId, hostId })
    )
  }
  runtime.clearOptimisticReconcileToken(args.worktreeId)
  await removeWorktreeMetadataAndTransientState(
    { store, runtime },
    args.worktreeId,
    hostId,
    args.snapshotPruneBatchId
  )
  invalidateAuthorizedRootsCache()
  notifyWorktreesChanged(mainWindow, repo.id)
  return result
}
