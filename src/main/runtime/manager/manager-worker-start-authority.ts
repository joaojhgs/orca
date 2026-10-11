import type { z } from 'zod'
import type { ManagerWorkerStartParams } from '../../../shared/rpc-contract/manager-params'
import type { OrcaRuntimeService } from '../orca-runtime'
import {
  getConnectionExecutionHostId,
  parseExecutionHostId,
  toSshExecutionHostId
} from '../../../shared/execution-host'
import { parseWorkerTerminalHostScope } from '../../../shared/worker-terminal-host-scope'
import { managerMayObserve } from '../../../shared/manager-event-contract'
import { managerWorkspaceScope } from './manager-hook-scope'
import { requireManagerPrincipal } from './manager-runtime-authority'
import { ManagerAuthorityError } from './manager-authority-error'
import { assertManagerWorkspaceCapacity } from './manager-workspace-capacity'
import { assertManagerAgentWorkspaceCapacity } from './manager-agent-workspace-capacity'
import { agentHookServer } from '../../agent-hooks/server'
import { getRegisteredSshState } from '../../ssh/ssh-target-registry'

type StartParams = z.infer<typeof ManagerWorkerStartParams>

export function managerWorkerStartAuthority(
  runtime: OrcaRuntimeService,
  params: StartParams,
  executionHostId: string
) {
  const db = runtime.getOrchestrationDb()
  const principal = requireManagerPrincipal(db, params.serviceToken, params.lease)
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
        const count = readWorkerCount(
          db.db
            .prepare(`SELECT COUNT(*) AS count FROM worker_dispatches w
          JOIN dispatch_contexts d ON d.id = w.dispatch_id
          JOIN manager_run_ownership o ON o.run_id = d.run_id
          WHERE o.principal_id = ? AND w.state IN
          ('starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown')`)
            .get(current.id)
        )
        if (count >= (current.grant.maxActiveWorkers ?? 2)) {
          throw new ManagerAuthorityError(
            'manager_forbidden',
            'Manager active-worker capacity reached; reconcile before launching'
          )
        }
        assertManagerAgentWorkspaceCapacity(
          agentHookServer.getEnrichedStatusSnapshot(),
          executionHostId,
          params.workspaceId,
          managerExecutionContact(executionHostId)
        )
        assertManagerWorkspaceCapacity(db, executionHostId, params.workspaceId)
        return operation()
      })
  }
}

function managerExecutionContact(executionHostId: string): 'connected' | 'unverifiable' {
  const host = parseExecutionHostId(executionHostId)
  return host?.kind === 'local' ||
    (host?.kind === 'ssh' && getRegisteredSshState(host.targetId)?.status === 'connected')
    ? 'connected'
    : 'unverifiable'
}

function readWorkerCount(value: unknown): number {
  if (
    !value ||
    typeof value !== 'object' ||
    !('count' in value) ||
    typeof value.count !== 'number' ||
    !Number.isSafeInteger(value.count)
  ) {
    throw new Error('Worker capacity is unconfirmed')
  }
  return value.count
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
