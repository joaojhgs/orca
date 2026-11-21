import type { Store } from '../../../persistence/loading-store/store'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { WorktreeCreateBaseFallback } from '../../../../shared/worktree/create-types'
import { WorktreeCreateCollisionError } from '../../../../shared/new-workspace/worktree-create-collision'
import { isGeneratedWorktreeCreateName } from '../../../../shared/new-workspace/worktree-create-retry-policy'
import { createRetiredNameLookup } from '../../../../shared/worktree/naming/retired-name-registry'
import type { IFilesystemProvider } from '../../../providers/types'
import {
  getBranchNameOverrideCandidate,
  getGeneratedWorktreeCreateCandidate,
  getWorktreeCreateCandidate,
  WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS
} from '../../../workspaces/creation/worktree-create-candidates'
import { getRetiredNameRegistryForRepo } from '../../../workspaces/removal/retirement/worktree-name-retirement'
import type { WorktreeCreatePathClaim } from '../../../workspaces/creation/worktree-create-in-flight'
import {
  exactNameBranchConflict,
  exactNameTakenError
} from '../../../workspaces/creation/worktree-create-exact-name'
import { resolveWorktreeCreateDisplayNameRequest } from '../creation/worktree-display-name'
import {
  computeRemoteWorktreePath,
  getWorktreePathSettings,
  hasRepoWorktreeBasePath,
  sanitizeWorktreeName
} from '../paths/worktree-logic'
import type { DirectSshWorktreeAuthority } from '../direct-ssh-worktree-authority'
import {
  getSelectedHostedReviewForBranch,
  isAllowedPushTargetRemoteConflict,
  type CreateWorktreeArgsWithSystemProvenance
} from '../worktree-remote'
import { getOrStartRemoteWorktreeCreateBasePlan } from './direct-ssh-worktree-git'
import {
  canCheckoutExistingLocalBranchSsh,
  getSshBranchConflictKind,
  getSshGitUsername,
  hasCommitRefSsh,
  hasRemoteWorktreeBaseRef,
  remotePathExists,
  resolveCreateBranchNameSsh
} from './direct-ssh-worktree-refs'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import type { ExecutionHostId } from '../../../../shared/execution-host/execution-host'

export async function planDirectSshWorktreeCreate({
  args,
  repo,
  store,
  settings,
  ssh,
  fsProvider,
  hostId,
  pathClaim
}: {
  args: CreateWorktreeArgsWithSystemProvenance
  repo: Repo
  store: Store
  settings: GlobalSettings
  ssh: DirectSshWorktreeAuthority
  fsProvider: IFilesystemProvider | undefined
  hostId: ExecutionHostId
  pathClaim: WorktreeCreatePathClaim
}) {
  const { provider } = ssh
  const exactName = args.branchIntent === 'create-exact'
  const worktreePathSettings = getWorktreePathSettings(repo, settings)
  let effectiveRequestedName = args.name
  const sanitizedName = sanitizeWorktreeName(args.name)
  let effectiveSanitizedName = sanitizedName
  const displayNameRequest = resolveWorktreeCreateDisplayNameRequest(
    args.displayName,
    args.displayNameKind,
    args.name,
    args.cliProvenance?.kind === 'created-by-cli',
    args.nameWasGenerated === true
  )

  // Why: base resolution probes refs via generic git.exec; register the repo root first so relays don't report a valid base as stale.
  await ssh.registerRoot(repo.path)

  // Why: explicit branches and non-username prefix modes never consume this; skipping the remote probe preserves the exact branch name.
  const branchConflictSubject = args.branchNameOverride ? 'branch name' : 'worktree name'
  // Why: don't fall back to hardcoded 'origin/main'; it may not exist (master/develop) and yields an opaque git error, so fail clearly and let the UI prompt.
  // Username and base-plan probes are independent read-only work; overlap them so
  // SSH latency is paid once before the conflict loop.
  const [username, basePlan] = await Promise.all([
    !args.branchNameOverride && settings.branchPrefix === 'git-username'
      ? getSshGitUsername(provider, repo.path)
      : Promise.resolve(''),
    getOrStartRemoteWorktreeCreateBasePlan(provider, repo, args.baseBranch)
  ])
  if (!basePlan) {
    throw new Error(
      'Could not resolve a default base ref for this repo. Pick a base branch explicitly and try again.'
    )
  }
  let { baseBranch } = basePlan
  let { remoteTrackingBase } = basePlan
  let baseFallback: WorktreeCreateBaseFallback | undefined

  if (remoteTrackingBase) {
    const [hasRemoteTrackingBaseRef, hasNamedLocalBaseRef] = await Promise.all([
      hasCommitRefSsh(provider, repo.path, remoteTrackingBase.ref),
      hasRemoteWorktreeBaseRef(provider, repo.path, baseBranch)
    ])
    const hasFallbackLocalBaseRef =
      !hasNamedLocalBaseRef &&
      (await hasRemoteWorktreeBaseRef(provider, repo.path, remoteTrackingBase.branch))
    if (!hasRemoteTrackingBaseRef && (hasNamedLocalBaseRef || hasFallbackLocalBaseRef)) {
      // Why: branch reuse and conflict checks must see the local fallback too.
      if (hasFallbackLocalBaseRef) {
        baseBranch = remoteTrackingBase.branch
      }
      baseFallback = {
        requestedRef: remoteTrackingBase.base,
        localRef: baseBranch
      }
      remoteTrackingBase = null
    }
  }

  let branchName = ''
  let checkoutExistingBranch = false
  let remotePath = ''
  let selectedExistingLocalBranchName: string | null = null
  let lastBranchConflictKind: 'local' | 'remote' | null = null
  let remotePathResolved = false
  const shouldRetireGeneratedName =
    args.nameWasGenerated === true && isGeneratedWorktreeCreateName(sanitizedName)
  const retiredNameRegistry = shouldRetireGeneratedName
    ? await getRetiredNameRegistryForRepo(store, repo, store.getRepos(), settings)
    : null
  const isRetiredName = retiredNameRegistry ? createRetiredNameLookup(retiredNameRegistry) : null
  // Why: duplicate PR/MR checkouts still need a workspace; suffix branch/path while preserving review metadata and push target.
  for (let suffix = 1, attempts = 0; attempts < WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS; suffix += 1) {
    if (exactName && suffix > 1) {
      throw exactNameTakenError(args.name)
    }
    effectiveSanitizedName = shouldRetireGeneratedName
      ? getGeneratedWorktreeCreateCandidate(
          sanitizedName,
          suffix,
          retiredNameRegistry?.exhaustedTiers
        )
      : getWorktreeCreateCandidate(sanitizedName, suffix)
    effectiveRequestedName = shouldRetireGeneratedName
      ? effectiveSanitizedName
      : args.name.trim()
        ? getWorktreeCreateCandidate(args.name, suffix)
        : effectiveSanitizedName
    if (isRetiredName?.(effectiveSanitizedName)) {
      continue
    }
    attempts += 1
    branchName = await resolveCreateBranchNameSsh(
      provider,
      repo.path,
      selectedExistingLocalBranchName ??
        getBranchNameOverrideCandidate(args.branchNameOverride, suffix),
      effectiveSanitizedName,
      settings,
      username
    )
    checkoutExistingBranch =
      args.branchIntent !== 'create-new' &&
      !exactName &&
      (await canCheckoutExistingLocalBranchSsh(provider, repo.path, branchName, baseBranch))
    if (checkoutExistingBranch && !selectedExistingLocalBranchName) {
      // Why: once a user-selected branch is safe to reuse, path retries keep it exact instead of creating a sibling.
      selectedExistingLocalBranchName = branchName
    }
    lastBranchConflictKind = exactName
      ? exactNameBranchConflict(
          await getSshBranchConflictKind(provider, repo.path, branchName, undefined, true),
          branchName
        )
      : checkoutExistingBranch
        ? null
        : await getSshBranchConflictKind(
            provider,
            repo.path,
            branchName,
            args.branchIntent === 'create-new' ? undefined : baseBranch
          )
    if (lastBranchConflictKind) {
      const selectedReview =
        !exactName && isAllowedPushTargetRemoteConflict(lastBranchConflictKind, branchName, args)
          ? await getSelectedHostedReviewForBranch(repo, branchName, args).catch(() => null)
          : null
      if (!selectedReview?.matchesSelected) {
        continue
      }
      lastBranchConflictKind = null
    }
    remotePath = computeRemoteWorktreePath(
      effectiveSanitizedName,
      repo.path,
      worktreePathSettings,
      {
        useConfiguredAbsolutePath: hasRepoWorktreeBasePath(repo)
      }
    )
    if (
      !(await remotePathExists(fsProvider, remotePath)) &&
      pathClaim.claim(`${hostId}:${remotePath}`)
    ) {
      remotePathResolved = true
      break
    }
  }
  if (!remotePathResolved) {
    if (lastBranchConflictKind) {
      throw new WorktreeCreateCollisionError(
        `Branch "${branchName}" already exists ${lastBranchConflictKind === 'local' ? 'locally' : 'on a remote'}. Pick a different ${branchConflictSubject}.`
      )
    }
    throw new Error(
      `Could not find an available remote worktree path for "${sanitizedName}". Pick a different worktree name.`
    )
  }

  return {
    baseBranch,
    remoteTrackingBase,
    baseFallback,
    branchName,
    checkoutExistingBranch,
    remotePath,
    displayNameRequest,
    effectiveRequestedName,
    effectiveSanitizedName,
    shouldRetireGeneratedName
  }
}

export type DirectSshWorktreeCreatePlan = Awaited<ReturnType<typeof planDirectSshWorktreeCreate>>
