import type { BranchPrefixSettings } from '../../../../shared/git/branches/branch-prefix'
import { resolveWorktreeAddBaseRef } from '../../../../shared/worktree/base-refs/base-ref'
import { hasCommitObjectViaGitExec } from '../../../git/refs/resolution/commit-object-ref'
import {
  getBranchConflictKindStrictViaExec,
  getBranchConflictKindViaExec,
  type StrictBranchConflictKind
} from '../../../git/refs/resolution/repo-branch-conflict'
import {
  normalizeGitUsername,
  isBranchSafeHostedLogin
} from '../../../git/repositories/git-username'
import type { SshGitProvider } from '../../../providers/ssh-git-provider'
import type { IFilesystemProvider } from '../../../providers/types'
import { isENOENT } from '../../../filesystem/local-file-io/filesystem-path-containment'
import { computeValidatedBranchName } from '../creation/worktree-branch-name'

export async function getSshGitUsername(
  provider: SshGitProvider,
  repoPath: string
): Promise<string> {
  for (const key of ['github.user', 'user.username']) {
    try {
      const { stdout } = await provider.exec(['config', '--get', key], repoPath)
      const username = normalizeGitUsername(stdout)
      if (isBranchSafeHostedLogin(username)) {
        return username
      }
    } catch {
      // Config may omit hosted-account usernames.
    }
  }
  return ''
}

export async function unsetRemoteWorktreeCreationBase(
  provider: SshGitProvider,
  worktreePath: string,
  branchName: string
): Promise<void> {
  try {
    await provider.exec(
      ['config', '--local', '--unset-all', `branch.${branchName}.base`],
      worktreePath
    )
  } catch {
    // Best-effort cleanup; keep the sparse setup error as the actionable failure.
  }
}

export async function resolveCreateBranchNameSsh(
  provider: SshGitProvider,
  repoPath: string,
  branchNameOverride: string | undefined,
  sanitizedName: string,
  settings: BranchPrefixSettings,
  username: string | null
): Promise<string> {
  if (!branchNameOverride) {
    return computeValidatedBranchName(sanitizedName, settings, username)
  }
  if (branchNameOverride.startsWith('-')) {
    throw new Error('Branch name must not start with "-"')
  }
  await provider.exec(['check-ref-format', '--branch', branchNameOverride], repoPath)
  return branchNameOverride
}

export function normalizeLocalBranchName(branchName: string | undefined): string {
  return branchName?.replace(/^refs\/heads\//, '') ?? ''
}

function hasRemoteCommitObject(
  provider: SshGitProvider,
  repoPath: string,
  ref: string
): Promise<boolean> {
  return hasCommitObjectViaGitExec((gitArgs) => provider.exec(gitArgs, repoPath), ref)
}

export async function hasRemoteWorktreeBaseRef(
  provider: SshGitProvider,
  repoPath: string,
  baseRef: string
): Promise<boolean> {
  const refExists = (qualifiedRef: string) => hasCommitRefSsh(provider, repoPath, qualifiedRef)
  const resolvedBaseRef = await resolveWorktreeAddBaseRef(baseRef, refExists)
  if (resolvedBaseRef !== baseRef) {
    return true
  }
  if (baseRef.startsWith('refs/')) {
    return refExists(baseRef)
  }
  return hasRemoteCommitObject(provider, repoPath, baseRef)
}

// Why: hasRemoteCommitObject resolves only SHAs, not symbolic refs; resolve any qualified ref (remote-tracking or local head) directly.
export async function hasCommitRefSsh(
  provider: SshGitProvider,
  repoPath: string,
  ref: string
): Promise<boolean> {
  try {
    const { stdout } = await provider.exec(
      ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
      repoPath
    )
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

export async function canCheckoutExistingLocalBranchSsh(
  provider: SshGitProvider,
  repoPath: string,
  branchName: string,
  baseBranch: string
): Promise<boolean> {
  let localHead = ''
  try {
    const { stdout } = await provider.exec(
      ['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}^{commit}`],
      repoPath
    )
    localHead = stdout.trim()
  } catch {
    return false
  }
  if (normalizeLocalBranchName(baseBranch) !== branchName) {
    if (!localHead) {
      return false
    }
    try {
      const { stdout } = await provider.exec(
        ['rev-parse', '--verify', '--quiet', `${baseBranch}^{commit}`],
        repoPath
      )
      if (stdout.trim() !== localHead) {
        return false
      }
    } catch {
      return false
    }
  }
  const worktrees = await provider.listWorktrees(repoPath)
  return !worktrees.some((worktree) => normalizeLocalBranchName(worktree.branch) === branchName)
}

type SshGitExecutor = Pick<SshGitProvider, 'exec'>

export function getSshBranchConflictKind(
  provider: SshGitExecutor,
  repoPath: string,
  branchName: string,
  allowedBaseRef: string | undefined,
  strict: true
): Promise<StrictBranchConflictKind | null>
export function getSshBranchConflictKind(
  provider: SshGitExecutor,
  repoPath: string,
  branchName: string,
  allowedBaseRef: string | undefined,
  strict?: false
): Promise<'local' | 'remote' | null>
export function getSshBranchConflictKind(
  provider: SshGitExecutor,
  repoPath: string,
  branchName: string,
  allowedBaseRef: string | undefined,
  strict = false
): Promise<StrictBranchConflictKind | null> {
  const getConflict = strict ? getBranchConflictKindStrictViaExec : getBranchConflictKindViaExec
  return getConflict(
    (argv, commandOptions) =>
      commandOptions?.timeoutMs === undefined
        ? provider.exec(argv, repoPath)
        : provider.exec(argv, repoPath, { timeoutMs: commandOptions.timeoutMs }),
    branchName,
    allowedBaseRef
  )
}

export async function remotePathExists(
  fsProvider: IFilesystemProvider | null | undefined,
  pathValue: string
): Promise<boolean> {
  if (!fsProvider?.stat) {
    return false
  }
  try {
    await fsProvider.stat(pathValue)
    return true
  } catch (error) {
    if (isENOENT(error)) {
      return false
    }
    throw error
  }
}
