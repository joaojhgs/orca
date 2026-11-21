import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import { getRepoExecutionHostId } from '../../shared/execution-host/execution-host'
import type { SkillLibrarySnapshot } from '../../shared/skill-library-contract'

export function skillLibraryProjectTargets(
  projects: readonly { id: string; displayName: string; sourceRepoIds: string[] }[],
  repos: readonly {
    id: string
    path: string
    connectionId?: string | null
    executionHostId?: 'local' | `ssh:${string}` | `runtime:${string}` | null
  }[],
  workspaces: SkillLibrarySnapshot['workspaces']
) {
  return projects.map((project) => {
    const roots = repos.filter((repo) => project.sourceRepoIds.includes(repo.id))
    return {
      id: project.id,
      label: project.displayName,
      workspaceKeys: workspaces
        .filter((workspace) =>
          roots.some((repo) => {
            if (workspace.hostId !== getRepoExecutionHostId(repo)) {
              return false
            }
            if (workspace.kind === 'worktree') {
              return getRepoIdFromWorktreeId(workspace.id) === repo.id
            }
            const prefix = repo.path.replaceAll('\\', '/').replace(/\/+$/, '')
            const folder = workspace.label.replaceAll('\\', '/').replace(/\/+$/, '')
            return folder === prefix || folder.startsWith(`${prefix}/`)
          })
        )
        .map((workspace) => `${workspace.kind}:${workspace.id}`)
    }
  })
}
