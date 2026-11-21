import { randomUUID } from 'node:crypto'
import type { Store } from '../../../persistence/loading-store/store'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { WorktreeMeta } from '../../../../shared/worktree/meta-types'
import type { GitPushTarget } from '../../../../shared/worktree/types'
import { composeWorktreeId } from '../../../../shared/worktree/id'
import { getProjectHostSetupWorktreeMeta } from '../../../../shared/project/host-setup/project-host-setup-lookup'
import { isTuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent-config'
import type { WorktreeCreateTimingRecorder } from '../../../workspaces/creation/worktree-create-timing'
import { configureCreatedWorktreePushTargetWithExec } from '../../../git/remotes/worktree-push-target-setup'
import { hostWorktreeTargetForRepo } from '../../../persistence/host-qualified-worktree-meta'
import { resolveWorktreeCreateDisplayNameMeta } from '../creation/worktree-display-name'
import { getWorktreeCreationLayout } from '../paths/worktree-logic'
import { mergeWorktree } from '../metadata/worktree-metadata-merge'
import type { DirectSshWorktreeAuthority } from '../direct-ssh-worktree-authority'
import {
  recordWorkspaceLineageForCreatedWorktree,
  type CreateWorktreeArgsWithSystemProvenance
} from '../worktree-remote'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import type { ExecutionHostId } from '../../../../shared/execution-host/execution-host'
import type { GitWorktreeInfo } from '../../../../shared/worktree/types'
import type { DirectSshWorktreeCreatePlan } from './direct-ssh-worktree-plan'

export async function persistDirectSshCreatedWorktree({
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
}: {
  args: CreateWorktreeArgsWithSystemProvenance
  repo: Repo
  store: Store
  settings: GlobalSettings
  ssh: DirectSshWorktreeAuthority
  hostId: ExecutionHostId
  timing: WorktreeCreateTimingRecorder
  assertCurrent: () => void
  plan: DirectSshWorktreeCreatePlan
  created: GitWorktreeInfo
  metadataBaseRef: string
  sparseDirectories: string[]
  sparsePresetId: string | undefined
  onWorkspaceCreated?: (worktreeId: string) => void
}) {
  const { provider } = ssh
  const {
    branchName,
    checkoutExistingBranch,
    displayNameRequest,
    effectiveRequestedName,
    effectiveSanitizedName
  } = plan
  const worktreeId = composeWorktreeId(repo.id, created.path)
  const now = Date.now()
  // Why: defer the remote add + fetch to first push/pull/fetch/fast-forward
  // (#17828) instead of paying it at create time for a read-only review.
  const preparedPushTarget: GitPushTarget | undefined = args.pushTarget

  // Why: `--set-upstream-to` needs the remote to exist -- true for a same-repo
  // target but not for a fork remote, which materializes lazily (#17828).
  let configuredPushTarget: GitPushTarget | undefined = preparedPushTarget
  if (preparedPushTarget && !preparedPushTarget.remoteUrl) {
    configuredPushTarget = await configureCreatedWorktreePushTargetWithExec(
      (argv, cwd) => {
        assertCurrent()
        return provider.exec(argv, cwd)
      },
      created.path,
      branchName,
      preparedPushTarget
    )
  }
  const metaUpdates: Partial<WorktreeMeta> = {
    // Why: path-derived IDs get reused after external deletion; rotate instance identity so stale lineage can't attach to the new occupant.
    instanceId: randomUUID(),
    ...(store.getProjectHostSetups
      ? getProjectHostSetupWorktreeMeta(store.getProjectHostSetups(), repo)
      : {}),
    lastActivityAt: now,
    // Why: grace window atop Recent so ambient PTY bumps on others during create don't bury the new worktree. See smart-sort.ts `CREATE_GRACE_MS`.
    createdAt: now,
    orcaCreatedAt: now,
    orcaCreationSource: 'ssh',
    creatorProvenance: args.creatorProvenance ?? { kind: 'host' },
    orcaCreationWorkspaceLayout: getWorktreeCreationLayout(repo, settings),
    ...(args.automationProvenance ? { automationProvenance: args.automationProvenance } : {}),
    ...(args.cliProvenance ? { cliProvenance: args.cliProvenance } : {}),
    baseRef: metadataBaseRef,
    ...(checkoutExistingBranch ? { preserveBranchOnDelete: true } : {}),
    ...(configuredPushTarget ? { pushTarget: configuredPushTarget } : {}),
    ...resolveWorktreeCreateDisplayNameMeta(
      displayNameRequest.value,
      branchName,
      displayNameRequest.kind,
      { requestedName: effectiveRequestedName, sanitizedName: effectiveSanitizedName }
    ),
    ...(isTuiAgent(args.createdWithAgent) ? { createdWithAgent: args.createdWithAgent } : {}),
    ...(args.pendingFirstAgentMessageRename === true && isTuiAgent(args.createdWithAgent)
      ? { pendingFirstAgentMessageRename: true }
      : {}),
    ...(sparseDirectories.length > 0
      ? {
          sparseDirectories,
          sparseBaseRef: metadataBaseRef,
          sparsePresetId
        }
      : {}),
    ...(args.linkedIssue !== undefined ? { linkedIssue: args.linkedIssue } : {}),
    ...(args.linkedPR !== undefined ? { linkedPR: args.linkedPR } : {}),
    ...(args.linkedLinearIssue !== undefined ? { linkedLinearIssue: args.linkedLinearIssue } : {}),
    ...(args.linkedLinearIssueWorkspaceId !== undefined
      ? { linkedLinearIssueWorkspaceId: args.linkedLinearIssueWorkspaceId }
      : {}),
    ...(args.linkedLinearIssueOrganizationUrlKey !== undefined
      ? { linkedLinearIssueOrganizationUrlKey: args.linkedLinearIssueOrganizationUrlKey }
      : {}),
    ...(args.manualOrder !== undefined ? { manualOrder: args.manualOrder } : {}),
    ...(args.linkedGitLabIssue !== undefined ? { linkedGitLabIssue: args.linkedGitLabIssue } : {}),
    ...(args.linkedGitLabMR !== undefined ? { linkedGitLabMR: args.linkedGitLabMR } : {}),
    ...(args.linkedBitbucketPR !== undefined ? { linkedBitbucketPR: args.linkedBitbucketPR } : {}),
    ...(args.linkedAzureDevOpsPR !== undefined
      ? { linkedAzureDevOpsPR: args.linkedAzureDevOpsPR }
      : {}),
    ...(args.linkedGiteaPR !== undefined ? { linkedGiteaPR: args.linkedGiteaPR } : {}),
    ...(args.linkedWorkItem !== undefined ? { linkedWorkItem: args.linkedWorkItem } : {}),
    ...(args.linkedItems !== undefined ? { linkedItems: args.linkedItems } : {}),
    ...(args.linkedTaskSourceContext !== undefined
      ? { linkedTaskSourceContext: args.linkedTaskSourceContext }
      : {}),
    ...(args.workspaceStatus !== undefined ? { workspaceStatus: args.workspaceStatus } : {})
  }
  assertCurrent()
  const { worktree } = timing.timeSync('persist_metadata', () => {
    const meta = store.setWorktreeMeta(hostWorktreeTargetForRepo(worktreeId, repo), {
      ...metaUpdates,
      hostId
    })
    return { worktree: mergeWorktree(repo.id, created, meta, repo.displayName) }
  })
  onWorkspaceCreated?.(worktreeId)
  const {
    lineage: worktreeLineage,
    workspaceLineage,
    crossStoreLineage
  } = recordWorkspaceLineageForCreatedWorktree(store, args, worktree, now)

  return { worktree, worktreeLineage, workspaceLineage, crossStoreLineage }
}
