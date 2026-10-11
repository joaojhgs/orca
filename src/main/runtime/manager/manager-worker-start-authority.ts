import { z } from 'zod'
import type { ManagerWorkerStartParams } from '../../../shared/rpc-contract/manager-params'
import type { OrcaRuntimeService } from '../orca-runtime'
import { getConnectionExecutionHostId, toSshExecutionHostId } from '../../../shared/execution-host'
import { parseWorkerTerminalHostScope } from '../../../shared/worker-terminal-host-scope'
import { managerMayObserve } from '../../../shared/manager-event-contract'
import { managerWorkspaceScope } from './manager-hook-scope'
import { requireManagerPrincipal } from './manager-runtime-authority'
import { ManagerAuthorityError } from './manager-authority-error'
import type { ManagerResourceSample } from './manager-dispatch-resource-sample'
import { checkManagerWorkerCapacity } from './manager-worker-capacity-check'
import { clearManagerTaskDispatchWaits } from './manager-dispatch-wait-store'

type StartParams = z.infer<typeof ManagerWorkerStartParams>

export function managerWorkerStartAuthority(
  runtime: OrcaRuntimeService,
  params: StartParams,
  executionHostId: string
) {
  const db = runtime.getOrchestrationDb()
  const principal = requireManagerPrincipal(db, params.serviceToken, params.lease)
  let resourceSample: ManagerResourceSample | null = null
  const assertAuthority = () =>
    db.managerPrincipals.withLease(params.lease, 'worker:start', () => {
      const current = db.managerPrincipals.authorize(principal.id, 'worker:start')
      const run = db.getRun(params.runId)
      db.managerRuns.requireOwnedRun(principal.id, run, current.grant.scope)
      const task = db.getTask(params.taskId)
      const scope = managerWorkspaceScope(
        params.workspaceId,
        executionHostId,
        runtime.listRepos(),
        runtime.listProjectHostSetups(),
        runtime.listFolderWorkspaces()
      )
      if (
        !task ||
        task.run_id !== params.runId ||
        !scope ||
        !managerMayObserve(current.grant.scope, scope)
      ) {
        throw new ManagerAuthorityError(
          'manager_forbidden',
          'Task or placement is outside the owned Run grant'
        )
      }
      return { principal: current, run, task, scope }
    })
  assertAuthority()
  return {
    principal,
    prepareCapacity: (sample: ManagerResourceSample) => {
      assertAuthority()
      resourceSample = sample
    },
    assertAuthority,
    assertPlacement: (dispatchId: string) => {
      assertAuthority()
      const dispatch = db.getDispatchContextById(dispatchId)
      const worker = db.getWorkerDispatch(dispatchId)
      const host = parseWorkerTerminalHostScope(dispatch?.host_scope ?? null)
      const actualHostId =
        host?.kind === 'ssh'
          ? toSshExecutionHostId(host.targetId)
          : host?.kind === 'local' || host?.kind === 'wsl'
            ? 'local'
            : null
      if (
        dispatch?.run_id !== params.runId ||
        worker?.worktree_id !== params.workspaceId ||
        actualHostId !== executionHostId
      ) {
        throw new ManagerAuthorityError(
          'manager_forbidden',
          'Actual worker placement differs from the approved target'
        )
      }
    },
    acceptDispatch: (operation: () => ReturnType<typeof db.createStartingWorkerDispatch>) =>
      db.managerPrincipals.withLease(params.lease, 'worker:start', () => {
        const current = assertAuthority().principal
        if (!resourceSample || resourceSample.executionHostId !== executionHostId) {
          throw new ManagerAuthorityError(
            'manager_forbidden',
            'Worker capacity was not sampled before acceptance'
          )
        }
        const { reservation } = checkManagerWorkerCapacity(
          runtime,
          current.id,
          params,
          resourceSample
        )
        const accepted = operation()
        const worker = db.getWorkerDispatch(accepted.dispatch.id)
        if (!worker) {
          throw new Error('Accepted worker reservation disappeared')
        }
        const options = z.record(z.string(), z.unknown()).parse(JSON.parse(worker.start_options))
        db.db
          .prepare('UPDATE worker_dispatches SET start_options = ? WHERE dispatch_id = ?')
          .run(
            JSON.stringify({ ...options, managerDispatchReservation: reservation }),
            accepted.dispatch.id
          )
        clearManagerTaskDispatchWaits(db, principal.id, params.taskId)
        return accepted
      })
  }
}

export async function resolveManagerWorkerPlacement(
  runtime: OrcaRuntimeService,
  params: StartParams
) {
  const workspace = await runtime.showTerminalWorkspaceLaunchScope(`id:${params.workspaceId}`)
  if (workspace.id !== params.workspaceId) {
    throw new ManagerAuthorityError('manager_forbidden', 'Exact worker workspace was not resolved')
  }
  return getConnectionExecutionHostId(workspace.connectionId)
}
