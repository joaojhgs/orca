import { captureDirectSshWorktreeAuthority } from '../../../ipc/worktrees/direct-ssh-worktree-authority'
import { resolveWorktreeCreateRoute } from '../../../workspaces/creation/worktree-create-execution-host-route'
import type { GitHubPrStartPoint } from '../../../../shared/worktree/types'
import type { Repo } from '../../../../shared/repository/repo-types'
import {
  fetchPrHeadTrackingRef,
  fetchGitHubPullRequestHeadRef
} from '../../../github/pull-requests/start-points/pr-head-tracking-ref'
import { resolveGitHubPrStartPoint } from '../../../github/pull-requests/start-points/pr-start-point'
import { resolvePrStartPointUnlessWslStopped } from '../../../github/pull-requests/start-points/pr-start-point-wsl-gate'
import { resolveGitHubReviewHeadRemote } from '../../../github/pull-requests/start-points/review-head-remote'
import { gitExecFileAsync } from '../../../git/command-runner/git-exec-file'
import {
  getLocalProjectGitExecOptions,
  getLocalProjectGhExecOptions
} from '../../../workspaces/execution-host/project-runtime-git-options'
import { isFolderRepo } from '../../../../shared/repository/repo-kind'
import { requireRepoLocalGitRoute } from '../../../workspaces/execution-host/repo-execution-host'
import type { ProjectRuntimeResolutionStore } from '../../../workspaces/execution-host/local-project-runtime-resolution'
import { reviewStartPointFailure } from '../../../../shared/worktree/hosted-review/review-start-point-failure-copy'

export type RuntimeGitHubWorktreeBaseArgs = {
  repoSelector: string
  prNumber: number
  headRefName?: string
  baseRefName?: string
  isCrossRepository?: boolean
  /** The user creating or launching from the PR: it may start a stopped WSL distro. */
  wakeWslDistro?: boolean
}

export async function resolveRuntimeGitHubWorktreeBase(
  args: RuntimeGitHubWorktreeBaseArgs,
  deps: {
    store: ProjectRuntimeResolutionStore | null
    resolveRepo: (selector: string) => Promise<Repo>
  }
): Promise<GitHubPrStartPoint | { error: string }> {
  if (!deps.store) {
    throw new Error('runtime_unavailable')
  }
  let repo: Repo
  try {
    repo = await deps.resolveRepo(args.repoSelector)
  } catch {
    return reviewStartPointFailure('repoNotFound')
  }
  if (isFolderRepo(repo)) {
    return reviewStartPointFailure('folderUnsupported')
  }
  const route = resolveWorktreeCreateRoute(repo)
  const ssh = route.kind === 'ssh' ? captureDirectSshWorktreeAuthority(route.connectionId) : null
  if (ssh) {
    await ssh.registerRoot(repo.path)
  } else {
    requireRepoLocalGitRoute(repo)
  }
  const connectionId = ssh?.connectionId ?? null
  const localGitExecOptions = ssh ? undefined : getLocalProjectGitExecOptions(deps.store, repo)
  const localGhOptions = ssh
    ? repo.ghAccount
      ? { ghAccount: repo.ghAccount }
      : undefined
    : getLocalProjectGhExecOptions(deps.store, repo)
  const gitExec = (gitArgs: string[]) => {
    if (ssh) {
      ssh.assertCurrent()
      return ssh.provider.exec(gitArgs, repo.path)
    }
    return gitExecFileAsync(gitArgs, localGitExecOptions ?? { cwd: repo.path })
  }
  const resolveRemote = (): Promise<string> =>
    resolveGitHubReviewHeadRemote({
      repoPath: repo.path,
      issueSourcePreference: repo.issueSourcePreference,
      connectionId,
      localGitOptions: localGhOptions,
      gitExec
    })
  const fetchRemoteTrackingRef = (remote: string, branch: string): Promise<void> => {
    if (ssh) {
      ssh.assertCurrent()
      return ssh.provider.fetchRemoteTrackingRef(
        repo.path,
        remote,
        branch,
        `refs/remotes/${remote}/${branch}`
      )
    }
    return fetchPrHeadTrackingRef(repo, remote, branch, { localGitExecOptions })
  }
  const fetchPullRequestHeadRef = (remote: string, prNumber: number): Promise<string> => {
    if (ssh) {
      ssh.assertCurrent()
      return ssh.provider.fetchGitHubPullRequestHead(repo.path, remote, prNumber)
    }
    return fetchGitHubPullRequestHeadRef(repo, remote, prNumber, { localGitExecOptions })
  }
  // A paired client's push-target ensure asks unprompted; it must not start a stopped distro (E9).
  return resolvePrStartPointUnlessWslStopped(
    { path: repo.path, wslDistro: localGitExecOptions?.wslDistro },
    { wakeWslDistro: args.wakeWslDistro },
    () =>
      resolveGitHubPrStartPoint({
        repoPath: repo.path,
        prNumber: args.prNumber,
        headRefName: args.headRefName,
        baseRefName: args.baseRefName,
        isCrossRepository: args.isCrossRepository,
        issueSourcePreference: repo.issueSourcePreference,
        connectionId,
        localGitOptions: localGhOptions,
        gitExec,
        fetchRemoteTrackingRef,
        fetchPullRequestHeadRef,
        resolveRemote
      })
  )
}
