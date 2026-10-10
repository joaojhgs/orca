import type { OrcaRuntimeService } from '../orca-runtime'
import { getConnectionExecutionHostId } from '../../../shared/execution-host'
import { managerWorkspaceScope } from './manager-hook-scope'
import { ManagerAuthorityError } from './manager-authority-error'

export async function resolveManagerWorkspaceScope(
  runtime: OrcaRuntimeService,
  workspaceId: string
) {
  const workspace = await runtime.showTerminalWorkspaceLaunchScope(`id:${workspaceId}`)
  const scope = managerWorkspaceScope(
    workspace.id,
    getConnectionExecutionHostId(workspace.connectionId),
    runtime.listRepos(),
    runtime.listProjectHostSetups(),
    runtime.listFolderWorkspaces()
  )
  if (workspace.id !== workspaceId || !scope) {
    throw new ManagerAuthorityError('manager_forbidden', 'Workspace has no canonical owner')
  }
  return { workspace, scope }
}
