import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { EnrichedAgentHookEventPayload } from '../agent-hooks/server/server-types'
import type { NotificationPolicyTarget } from '../../shared/notification-policy-target'
import { notificationSelectorKey } from '../../shared/notification-policy-target'
import { managerWorkspaceScope, managerHookScope } from '../runtime/manager/manager-hook-scope'
import { agentHookGeneration } from '../agent-hooks/agent-hook-generation'
import { getRepoMainWorktreeId } from '../../shared/worktree/id'
import { getRepoExecutionHostId, getConnectionExecutionHostId } from '../../shared/execution-host'
import { folderWorkspaceKey } from '../../shared/workspace-scope'

/** Cached identities only; opening Settings does not scan hosts or publish launch credentials. */
export function notificationPolicyTargets(
  runtime: Pick<
    OrcaRuntimeService,
    'listRepos' | 'listProjectHostSetups' | 'listProjectGroups' | 'listFolderWorkspaces'
  >,
  statuses: readonly EnrichedAgentHookEventPayload[]
): NotificationPolicyTarget[] {
  const repos = runtime.listRepos()
  const setups = runtime.listProjectHostSetups()
  const folders = runtime.listFolderWorkspaces()
  const rows: NotificationPolicyTarget[] = [
    { label: 'All projects', selector: { level: 'server' }, scope: {} }
  ]
  for (const group of runtime.listProjectGroups()) {
    rows.push({
      label: `Group: ${group.name}`,
      selector: { level: 'project-group', id: group.id },
      scope: { projectGroupId: group.id }
    })
  }
  for (const repo of repos) {
    const scope = managerWorkspaceScope(
      getRepoMainWorktreeId(repo),
      getRepoExecutionHostId(repo),
      repos,
      setups,
      folders
    )
    if (scope?.projectId) {
      rows.push({
        label: `Project: ${repo.displayName}`,
        selector: { level: 'project', id: scope.projectId },
        scope: { projectId: scope.projectId, projectGroupId: scope.projectGroupId }
      })
    }
    if (scope?.workspaceId) {
      rows.push({
        label: `Workspace: ${repo.displayName} (${scope.executionHostId})`,
        selector: {
          level: 'workspace',
          id: scope.workspaceId,
          executionHostId: scope.executionHostId
        },
        scope
      })
    }
  }
  for (const folder of folders.filter((row) => !row.isArchived)) {
    const scope = managerWorkspaceScope(
      folderWorkspaceKey(folder.id),
      folder.executionHostId ?? getConnectionExecutionHostId(folder.connectionId),
      repos,
      setups,
      folders
    )
    if (scope) {
      rows.push({
        label: `Workspace: ${folder.name} (${scope.executionHostId})`,
        selector: {
          level: 'workspace',
          id: folderWorkspaceKey(folder.id),
          executionHostId: scope.executionHostId
        },
        scope
      })
    }
  }
  for (const event of statuses) {
    const scope = managerHookScope(event, repos, setups, undefined, folders)
    if (!scope?.workspaceId) {
      continue
    }
    const sessionId = event.providerSession?.id ?? event.paneKey
    const generation = agentHookGeneration(event)
    rows.push({
      label: `Workspace: ${scope.workspaceId} (${scope.executionHostId})`,
      selector: {
        level: 'workspace',
        id: scope.workspaceId,
        executionHostId: scope.executionHostId
      },
      scope
    })
    rows.push({
      label: `Session: ${event.payload.agentType ?? 'agent'} · ${sessionId} (${scope.executionHostId})`,
      selector: { level: 'session', id: sessionId, generation },
      scope: { ...scope, sessionId, sessionGeneration: generation }
    })
  }
  return [...new Map(rows.map((row) => [notificationSelectorKey(row.selector), row])).values()]
}
