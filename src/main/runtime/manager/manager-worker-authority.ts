import type { OrcaRuntimeService } from '../orca-runtime'
import { requireManagerPrincipal } from './manager-runtime-authority'
import { ManagerAuthorityError } from './manager-authority-error'
import { managerWorkspaceScope } from './manager-hook-scope'
import { managerMayObserve } from '../../../shared/manager-event-contract'
import { parseWorkerTerminalHostScope } from '../../../shared/worker-terminal-host-scope'
import { toSshExecutionHostId, toRuntimeExecutionHostId } from '../../../shared/execution-host'

export function requireManagerWorker(
  runtime: OrcaRuntimeService,
  params: {
    serviceToken: string
    runId: string
    dispatchId: string
  }
) {
  const db = runtime.getOrchestrationDb()
  const principal = requireManagerPrincipal(db, params.serviceToken)
  const grant = db.managerPrincipals.authorize(principal.id, 'worker:read').grant.scope
  db.managerRuns.requireOwnedRun(principal.id, db.getRun(params.runId), grant)
  const dispatch = db.getDispatchContextById(params.dispatchId)
  if (!dispatch || dispatch.run_id !== params.runId) {
    throw new ManagerAuthorityError('manager_forbidden', 'Dispatch is not in the addressed Run')
  }
  const worker = db.getWorkerDispatch(params.dispatchId)
  const federated = db.getFederatedDispatch(params.dispatchId)
  const host = parseWorkerTerminalHostScope(dispatch.host_scope)
  const executionHostId = federated
    ? toRuntimeExecutionHostId(federated.environment_id)
    : host?.kind === 'ssh'
      ? toSshExecutionHostId(host.targetId)
      : host?.kind === 'local' || host?.kind === 'wsl'
        ? 'local'
        : null
  const workspaceId = federated?.remote_worktree_id ?? worker?.worktree_id
  const scope =
    executionHostId &&
    workspaceId &&
    managerWorkspaceScope(
      workspaceId,
      executionHostId,
      runtime.listRepos(),
      runtime.listProjectHostSetups(),
      runtime.listFolderWorkspaces()
    )
  if (!scope || !managerMayObserve(grant, scope)) {
    throw new ManagerAuthorityError(
      'manager_forbidden',
      'Worker placement is outside the grant or unconfirmed'
    )
  }
  return dispatch
}
