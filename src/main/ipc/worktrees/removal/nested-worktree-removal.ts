import type { Repo } from '../../../../shared/repository/repo-types'
import {
  getRepoDialableSshTargetId,
  type ExecutionHostId
} from '../../../../shared/execution-host/execution-host'
import type { GitWorktreeInfo } from '../../../../shared/worktree/types'
import type { RemoveWorktreeResult } from '../../../../shared/worktree/create-types'
import { isFolderRepo } from '../../../../shared/repository/repo-kind'
import { listWorktreesStrict } from '../../../git/worktrees/catalog/worktree-listing'
import { getLocalProjectWorktreeGitOptions } from '../../../workspaces/execution-host/project-runtime-git-options'
import { captureDirectSshWorktreeAuthority } from '../direct-ssh-worktree-authority'
import { resolveWorktreeRemovalHomeForHost } from '../../../workspaces/removal/worktree-removal-execution-host-route'
import {
  getNestedWorktreeRemovalPlan,
  assertNestedWorktreeRemovalApproval,
  removeNestedWorktreePlanChildren
} from '../../../workspaces/removal/nested-worktree-removal-plan'
import type { RemoveWorktreeArgs } from '../ipc-context-schemas'
import type { WorktreeIpcContext } from '../worktree-ipc-context'
import { assertRemovalHostMatchesRepoRow } from '../repo-host-ownership'

export async function previewNestedWorktreeRemoval(
  context: WorktreeIpcContext,
  repo: Repo,
  worktreePath: string,
  hostId: ExecutionHostId
): Promise<GitWorktreeInfo[]> {
  if (isFolderRepo(repo)) {
    throw new Error('Nested worktree deletion is only available for Git workspaces.')
  }
  assertRemovalHostMatchesRepoRow(repo, repo.id, hostId)
  const connectionId = getRepoDialableSshTargetId(repo)
  const ssh = connectionId ? captureDirectSshWorktreeAuthority(connectionId) : null
  const worktrees = ssh
    ? await ssh.provider.listWorktrees(repo.path)
    : await listWorktreesStrict(repo.path, getLocalProjectWorktreeGitOptions(context.store, repo))
  ssh?.assertCurrent()
  return getNestedWorktreeRemovalPlan({
    repoPath: repo.path,
    worktreePath,
    worktrees,
    home: ssh?.removalHome() ?? resolveWorktreeRemovalHomeForHost(hostId)
  })
}

export async function removeApprovedNestedWorktrees(args: {
  context: WorktreeIpcContext
  repo: Repo
  worktreePath: string
  hostId: ExecutionHostId
  removalArgs: RemoveWorktreeArgs
  remove: (args: RemoveWorktreeArgs) => Promise<RemoveWorktreeResult>
}): Promise<NonNullable<RemoveWorktreeResult['nestedPreservedBranches']>> {
  const { context, repo, worktreePath, hostId, removalArgs, remove } = args
  if (!removalArgs.force || !removalArgs.approvedNestedWorktrees) {
    throw new Error('Deleting nested worktrees requires an explicit confirmation.')
  }
  const plan = await previewNestedWorktreeRemoval(context, repo, worktreePath, hostId)
  assertNestedWorktreeRemovalApproval(plan, removalArgs.approvedNestedWorktrees)
  return removeNestedWorktreePlanChildren(repo.id, plan, (worktreeId, child) =>
    remove({
      ...removalArgs,
      hostId,
      worktreeId,
      approvedNestedWorktrees: undefined,
      expectedCheckout: child
    })
  )
}
