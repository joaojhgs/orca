import { ipcMain } from 'electron'
import { prefetchWorktreeCreateBase } from '../../../workspaces/creation/worktree-create-base-prefetch'
import { prepareWorktreeCreateForRepo } from '../../../workspaces/creation/preparation/worktree-create-preparation'
import { getWorktreeCreatePrefetchGitOptions } from '../../../workspaces/execution-host/project-runtime-git-options'
import type { WorktreeIpcContext } from '../worktree-ipc-context'
import { blockedWslDistroForPath } from '../../../wsl/filesystem/wsl-unc-access-gate'
import { requireWorktreeCreateRoute } from '../../../workspaces/creation/worktree-create-execution-host-route'
import { captureDirectSshWorktreeAuthority } from '../direct-ssh-worktree-authority'
import { assertRemovalHostMatchesRepoRow } from '../repo-host-ownership'
import { prefetchRemoteWorktreeCreateBase } from './direct-ssh-worktree-git'

export function registerWorktreePrefetchHandler(context: WorktreeIpcContext): void {
  const { store, runtime } = context

  ipcMain.handle(
    'worktrees:prefetchCreateBase',
    async (_event, args: { repoId: string; baseBranch?: string }): Promise<void> => {
      const repo = store.getRepo(args.repoId)
      if (!repo) {
        return
      }
      try {
        const route = requireWorktreeCreateRoute(repo)
        assertRemovalHostMatchesRepoRow(repo, repo.id, route.hostId)
        if (route.kind === 'ssh') {
          await prefetchRemoteWorktreeCreateBase(
            captureDirectSshWorktreeAuthority(route.connectionId),
            repo,
            args
          )
          return
        }
        const gitOptions = getWorktreeCreatePrefetchGitOptions(store, repo)
        // Speculative: a composer opening is no act on the repo's WSL distro (E9).
        if (await blockedWslDistroForPath(repo.path, gitOptions.wslDistro)) {
          return
        }
        await prefetchWorktreeCreateBase({
          repo,
          baseBranch: args.baseBranch,
          runtime,
          gitOptions,
          prepareCheckout: (base, beforeMaterialization) =>
            prepareWorktreeCreateForRepo(store, repo, base, beforeMaterialization)
        })
      } catch {
        // Speculative failure is reported by the real create path when it retries this refresh.
      }
    }
  )
}
