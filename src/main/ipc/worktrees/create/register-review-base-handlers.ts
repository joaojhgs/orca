import { ipcMain } from 'electron'
import type { GitHubPrStartPoint, GitPushTarget } from '../../../../shared/worktree/types'
import { isFolderRepo } from '../../../../shared/repository/repo-kind'
import { gitExecFileAsync } from '../../../git/command-runner/git-exec-file'
import {
  getLocalProjectGhExecOptions,
  getLocalProjectGitExecOptions,
  getWorktreeCreatePrefetchGitOptions
} from '../../../workspaces/execution-host/project-runtime-git-options'
import { requireWorktreeCreateRoute } from '../../../workspaces/creation/worktree-create-execution-host-route'
import { captureDirectSshWorktreeAuthority } from '../direct-ssh-worktree-authority'
import { assertRemovalHostMatchesRepoRow } from '../repo-host-ownership'
import {
  fetchPrHeadTrackingRef,
  fetchGitHubPullRequestHeadRef
} from '../../../github/pull-requests/start-points/pr-head-tracking-ref'
import { resolveGitHubPrStartPoint } from '../../../github/pull-requests/start-points/pr-start-point'
import { resolvePrStartPointUnlessWslStopped } from '../../../github/pull-requests/start-points/pr-start-point-wsl-gate'
import { resolveGitHubReviewHeadRemote } from '../../../github/pull-requests/start-points/review-head-remote'
import type { WorktreeIpcContext } from '../worktree-ipc-context'
import { reviewStartPointFailure } from '../../../../shared/worktree/hosted-review/review-start-point-failure-copy'

export function registerReviewBaseHandlers(context: WorktreeIpcContext): void {
  const { store, runtime } = context

  ipcMain.handle(
    'worktrees:resolvePrBase',
    async (
      _event,
      args: {
        repoId: string
        prNumber: number
        headRefName?: string
        baseRefName?: string
        isCrossRepository?: boolean
        /** The user creating or launching from the PR: it may start a stopped WSL distro. */
        wakeWslDistro?: boolean
      }
    ): Promise<GitHubPrStartPoint | { error: string }> => {
      const repo = store.getRepo(args.repoId)
      if (!repo) {
        return reviewStartPointFailure('repoNotFound')
      }
      if (isFolderRepo(repo)) {
        return reviewStartPointFailure('folderUnsupported')
      }
      const route = requireWorktreeCreateRoute(repo)
      assertRemovalHostMatchesRepoRow(repo, repo.id, route.hostId)
      const ssh =
        route.kind === 'ssh' ? captureDirectSshWorktreeAuthority(route.connectionId) : null
      const connectionId = ssh?.connectionId ?? null
      await ssh?.registerRoot(repo.path)
      const gitExec = async (args: string[]): Promise<{ stdout: string; stderr: string }> => {
        if (!ssh) {
          return gitExecFileAsync(args, getLocalProjectGitExecOptions(store, repo))
        }
        ssh.assertCurrent()
        return ssh.provider.exec(args, repo.path)
      }
      const localGhOptions = connectionId
        ? repo.ghAccount
          ? { ghAccount: repo.ghAccount }
          : undefined
        : getLocalProjectGhExecOptions(store, repo)
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
        return fetchPrHeadTrackingRef(repo, remote, branch, {
          localGitExecOptions: getLocalProjectGitExecOptions(store, repo)
        })
      }
      const fetchPullRequestHeadRef = (remote: string, prNumber: number): Promise<string> => {
        if (ssh) {
          ssh.assertCurrent()
          return ssh.provider.fetchGitHubPullRequestHead(repo.path, remote, prNumber)
        }
        return fetchGitHubPullRequestHeadRef(repo, remote, prNumber, {
          localGitExecOptions: getLocalProjectGitExecOptions(store, repo)
        })
      }

      const resolve = () =>
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
          resolveRemote: () =>
            resolveGitHubReviewHeadRemote({
              repoPath: repo.path,
              issueSourcePreference: repo.issueSourcePreference,
              connectionId,
              localGitOptions: localGhOptions,
              gitExec
            })
        })
      if (ssh) {
        const result = await resolve()
        ssh.assertCurrent()
        return result
      }
      // Source Control's push-target ensure asks unprompted, so keep stopped WSL distros asleep.
      const { wslDistro } = getWorktreeCreatePrefetchGitOptions(store, repo)
      return resolvePrStartPointUnlessWslStopped(
        { path: repo.path, wslDistro },
        { wakeWslDistro: args.wakeWslDistro },
        resolve
      )
    }
  )

  ipcMain.handle(
    'worktrees:resolveMrBase',
    async (
      _event,
      args: {
        repoId: string
        mrIid: number
        sourceBranch?: string
        targetBranch?: string
        isCrossRepository?: boolean
        /** The user creating from the MR: it may start a stopped WSL distro. */
        wakeWslDistro?: boolean
      }
    ): Promise<
      | { baseBranch: string; compareBaseRef?: string; pushTarget?: GitPushTarget }
      | { error: string }
    > => {
      return runtime.resolveManagedMrBase({
        repoSelector: `id:${args.repoId}`,
        mrIid: args.mrIid,
        sourceBranch: args.sourceBranch,
        targetBranch: args.targetBranch,
        isCrossRepository: args.isCrossRepository,
        wakeWslDistro: args.wakeWslDistro
      })
    }
  )
}
