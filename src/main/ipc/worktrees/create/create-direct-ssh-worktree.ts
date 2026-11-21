import type { BrowserWindow } from 'electron'
import type { Store } from '../../../persistence/loading-store/store'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { CreateWorktreeResult } from '../../../../shared/worktree/create-types'
import { getRepoExecutionHostId } from '../../../../shared/execution-host/execution-host'
import { composeWorktreeId } from '../../../../shared/worktree/id'
import { worktreeWorkspaceKey } from '../../../../shared/workspace/identity/workspace-scope'
import { getSshFilesystemProvider } from '../../../providers/ssh-filesystem-dispatch'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import {
  createWorktreeCreateTimingRecorder,
  type WorktreeCreateTimingRecorder
} from '../../../workspaces/creation/worktree-create-timing'
import {
  openWorktreeCreatePathClaim,
  type WorktreeCreatePathClaim
} from '../../../workspaces/creation/worktree-create-in-flight'
import { normalizeSparseDirectories } from '../../repos/sparse-checkout-directories'
import { attributedSparsePresetId } from '../../repos/sparse-preset-attribution'
import { isCapturedRepoCurrent } from '../listing/worktree-host-ownership'
import type { DirectSshWorktreeAuthority } from '../direct-ssh-worktree-authority'
import {
  assertAttachableParentWorkspace,
  assertCreatableCrossStoreParent,
  notifyWorktreesChanged,
  type CreateWorktreeArgsWithSystemProvenance
} from '../worktree-remote'
import { planDirectSshWorktreeCreate } from './direct-ssh-worktree-plan'
import { checkoutDirectSshWorktree } from './direct-ssh-worktree-checkout'
import { persistDirectSshCreatedWorktree } from './direct-ssh-worktree-publication'
import { prepareDirectSshCreatedWorktreeSetup } from './direct-ssh-worktree-setup'

export { createRemoteSetupRunnerScript } from './direct-ssh-worktree-setup'

export async function createRemoteWorktree(
  args: CreateWorktreeArgsWithSystemProvenance,
  repo: Repo,
  store: Store,
  mainWindow: BrowserWindow | undefined,
  ssh: DirectSshWorktreeAuthority,
  runtime: Pick<OrcaRuntimeService, 'readStoreInstallationId'>,
  timing: WorktreeCreateTimingRecorder = createWorktreeCreateTimingRecorder(),
  onWorkspaceCreated?: (worktreeId: string) => void
): Promise<CreateWorktreeResult> {
  timing.recordExecutionHost('ssh')
  const pathClaim = openWorktreeCreatePathClaim()
  try {
    return await performRemoteWorktreeCreate(
      args,
      repo,
      store,
      mainWindow,
      ssh,
      runtime,
      timing,
      pathClaim,
      onWorkspaceCreated
    )
  } finally {
    pathClaim.release()
  }
}

async function performRemoteWorktreeCreate(
  args: CreateWorktreeArgsWithSystemProvenance,
  repo: Repo,
  store: Store,
  mainWindow: BrowserWindow | undefined,
  ssh: DirectSshWorktreeAuthority,
  runtime: Pick<OrcaRuntimeService, 'readStoreInstallationId'>,
  timing: WorktreeCreateTimingRecorder,
  pathClaim: WorktreeCreatePathClaim,
  onWorkspaceCreated?: (worktreeId: string) => void
): Promise<CreateWorktreeResult> {
  const fsProvider = getSshFilesystemProvider(ssh.connectionId)
  const hostId = getRepoExecutionHostId(repo)
  const assertCurrent = (): void => {
    ssh.assertCurrent()
    if (!isCapturedRepoCurrent(store, repo, hostId)) {
      throw new Error('SSH worktree repository ownership changed during creation.')
    }
  }
  if (args.crossStoreParent) {
    await assertCreatableCrossStoreParent(runtime, args.crossStoreParent)
  }
  assertCurrent()

  const settings = store.getSettings()
  const plan = await planDirectSshWorktreeCreate({
    args,
    repo,
    store,
    settings,
    ssh,
    fsProvider,
    hostId,
    pathClaim
  })

  assertAttachableParentWorkspace(
    store,
    args.parentWorkspace,
    worktreeWorkspaceKey(composeWorktreeId(repo.id, plan.remotePath))
  )

  const sparseDirectories = args.sparseCheckout
    ? normalizeSparseDirectories(args.sparseCheckout.directories)
    : []
  if (args.sparseCheckout && sparseDirectories.length === 0) {
    throw new Error('Sparse checkout requires at least one repo-relative directory.')
  }
  const sparsePresetId = attributedSparsePresetId(
    () => store.getSparsePresets(repo.id),
    repo.id,
    args.sparseCheckout?.presetId,
    sparseDirectories
  )

  const { created, metadataBaseRef, localBaseRefRefresh, localBaseRefUpdateSuggestion } =
    await checkoutDirectSshWorktree({
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
    })

  const { worktree, worktreeLineage, workspaceLineage, crossStoreLineage } =
    await persistDirectSshCreatedWorktree({
      args,
      repo,
      store,
      settings,
      ssh,
      hostId,
      timing,
      assertCurrent,
      plan,
      created,
      metadataBaseRef,
      sparseDirectories,
      sparsePresetId,
      onWorkspaceCreated
    })

  // Why: shared/symlink paths, `orca.yaml` shared directories, and `.worktreeinclude` copies are local-only; remote (SSH) support needs a new relay method + auth surface, so all are skipped here.

  const { setup, defaultTabs, setupTrustMismatch } = await prepareDirectSshCreatedWorktreeSetup(
    args,
    repo,
    created.path,
    ssh,
    fsProvider,
    timing
  )

  if (mainWindow) {
    notifyWorktreesChanged(mainWindow, repo.id)
  }
  return {
    worktree: {
      ...worktree,
      workspaceLineage,
      ...(worktreeLineage
        ? { lineage: worktreeLineage, parentWorktreeId: worktreeLineage.parentWorktreeId }
        : {})
    },
    ...(worktreeLineage ? { lineage: worktreeLineage } : {}),
    ...(workspaceLineage ? { workspaceLineage } : {}),
    ...(crossStoreLineage ? { crossStoreLineage } : {}),
    ...(setupTrustMismatch ? { setupTrustMismatch } : {}),
    ...(setup ? { setup } : {}),
    ...(defaultTabs ? { defaultTabs } : {}),
    ...(localBaseRefRefresh ? { localBaseRefRefresh } : {}),
    ...(localBaseRefUpdateSuggestion ? { localBaseRefUpdateSuggestion } : {}),
    ...(plan.baseFallback ? { baseFallback: plan.baseFallback } : {}),
    timing: timing.finish()
  }
}
