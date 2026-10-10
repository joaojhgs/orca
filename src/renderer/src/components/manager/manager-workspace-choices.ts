import type { AppState } from '@/store/types'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import type { SkillInstallWorkspaceChoice } from '@/components/skills/skill-install-workspace-choices'
import { resolveExactWorktreeRoute } from '@/lib/worktree-owner-route'
import { getFolderWorkspaceHostId } from '@/store/folder-workspaces/folder-workspace-catalog'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'

export function managerWorkspaceChoices(
  state: Pick<AppState, 'repos' | 'worktreesByRepo' | 'folderWorkspaces' | 'projectGroups'>,
  target: RuntimeClientTarget
): SkillInstallWorkspaceChoice[] {
  const owner = target.kind === 'environment' ? target.environmentId : null
  const choices = Object.values(state.worktreesByRepo)
    .flat()
    .flatMap((worktree) => {
      const route = resolveExactWorktreeRoute(state, worktree)
      if (route.kind === 'ambiguous') {
        return []
      }
      const repos = state.repos.filter((candidate) => candidate.id === worktree.repoId)
      if (route.kind === 'missing' && repos.length !== 1) {
        return []
      }
      const repo = repos[0]
      const repoHost = parseExecutionHostId(repo?.executionHostId)
      const runtimeOwner =
        route.kind === 'resolved'
          ? route.route.runtimeEnvironmentId
          : repoHost?.kind === 'runtime'
            ? repoHost.environmentId
            : null
      if (runtimeOwner !== owner || worktree.isArchived) {
        return []
      }
      const host = worktree.hostId ?? repo?.executionHostId ?? 'local'
      return [
        { id: worktree.id, label: `${worktree.displayName} · ${host}`, kind: 'worktree' as const }
      ]
    })
  const folders = state.folderWorkspaces.flatMap((folder) => {
    const host = parseExecutionHostId(getFolderWorkspaceHostId(folder, state.projectGroups))
    if ((host?.kind === 'runtime' ? host.environmentId : null) !== owner || folder.isArchived) {
      return []
    }
    return [
      {
        id: folderWorkspaceKey(folder.id),
        label: `${folder.name} · ${host?.id ?? 'local'}`,
        kind: 'folder' as const
      }
    ]
  })
  const unique = new Map<string, SkillInstallWorkspaceChoice | null>()
  for (const choice of [...choices, ...folders]) {
    unique.set(choice.id, unique.has(choice.id) ? null : choice)
  }
  return [...unique.values()]
    .filter((choice) => choice !== null)
    .sort((a, b) => a.label.localeCompare(b.label))
}
