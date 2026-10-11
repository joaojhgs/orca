import type { OrcaRuntimeService } from '../orca-runtime'
import { parseExecutionHostId } from '../../../shared/execution-host'
import { managerMayObserve } from '../../../shared/manager-event-contract'
import { ManagerDispatchPolicySchema } from '../../../shared/manager-dispatch-capacity-contract'
import { agentHookServer } from '../../agent-hooks/server'
import { getRegisteredSshState } from '../../ssh/ssh-target-registry'
import { managerWorkspaceScope } from './manager-hook-scope'
import { ManagerAuthorityError, ManagerCapacityUnavailableError } from './manager-authority-error'
import { assertManagerAgentWorkspaceCapacity } from './manager-agent-workspace-capacity'
import { assertManagerWorkspaceCapacity } from './manager-workspace-capacity'
import { selectManagerDispatchAccount } from './manager-dispatch-usage'
import { assertManagerDispatchCapacity } from './manager-dispatch-capacity'
import { readManagerTaskRequirements } from './manager-completion-evidence'
import type { ManagerResourceSample } from './manager-dispatch-resource-sample'

export type ManagerCapacityTarget = {
  runId: string
  taskId: string
  workspaceId: string
  agent: string
  model?: string
  workClass: 'edit' | 'build'
}

/** Shared admission/readiness check; only the worker-start authority can actually launch. */
export function checkManagerWorkerCapacity(
  runtime: OrcaRuntimeService,
  principalId: string,
  target: ManagerCapacityTarget,
  sample: ManagerResourceSample
) {
  const db = runtime.getOrchestrationDb()
  if (!db.db.isTransaction) {
    throw new Error('Capacity check requires a transaction')
  }
  const principal = db.managerPrincipals.authorize(principalId, 'worker:start')
  const run = db.getRun(target.runId)
  db.managerRuns.requireOwnedRun(principalId, run, principal.grant.scope)
  const scope = managerWorkspaceScope(
    target.workspaceId,
    sample.executionHostId,
    runtime.listRepos(),
    runtime.listProjectHostSetups(),
    runtime.listFolderWorkspaces()
  )
  const task = db.getTask(target.taskId)
  if (
    !task ||
    task.run_id !== target.runId ||
    task.status !== 'ready' ||
    !scope ||
    !managerMayObserve(principal.grant.scope, scope)
  ) {
    throw new ManagerAuthorityError('manager_forbidden', 'Task or placement is no longer eligible')
  }
  const requirements = readManagerTaskRequirements(db, target.taskId)
  const checks =
    requirements?.role === 'verification'
      ? readManagerTaskRequirements(db, requirements.verifiesTaskId)
      : requirements
  if (target.workClass === 'edit' && checks?.role === 'work' && checks.tests.length) {
    throw new ManagerAuthorityError(
      'manager_forbidden',
      'A Task with requested test commands must reserve build capacity'
    )
  }
  const policy = ManagerDispatchPolicySchema.parse(principal.grant.dispatchPolicy ?? {})
  const account = selectManagerDispatchAccount(
    runtime.getAccountsSnapshot().rateLimits.executionAccounts ?? [],
    { ...target, executionHostId: sample.executionHostId },
    policy,
    Date.now()
  )
  const reservation = {
    executionHostId: sample.executionHostId,
    accountId: account.id,
    workClass: target.workClass,
    memoryBytes: target.workClass === 'edit' ? policy.editMemoryBytes : policy.buildMemoryBytes,
    observedAt: sample.observedAt
  }
  const count = db.db
    .prepare(`SELECT COUNT(*) AS count FROM worker_dispatches w
    JOIN dispatch_contexts d ON d.id = w.dispatch_id JOIN manager_run_ownership o ON o.run_id = d.run_id
    WHERE o.principal_id = ? AND w.state IN ('starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown')`)
    .get(principalId)
  if (
    !count ||
    typeof count !== 'object' ||
    !('count' in count) ||
    typeof count.count !== 'number'
  ) {
    throw new Error('Worker capacity is unconfirmed')
  }
  if (count.count >= (principal.grant.maxActiveWorkers ?? 2)) {
    throw new ManagerCapacityUnavailableError(
      'Manager active-worker capacity reached; reconcile before launching'
    )
  }
  const host = parseExecutionHostId(sample.executionHostId)
  const contact =
    host?.kind === 'local' ||
    (host?.kind === 'ssh' && getRegisteredSshState(host.targetId)?.status === 'connected')
      ? 'connected'
      : 'unverifiable'
  const statuses = agentHookServer.getEnrichedStatusSnapshot()
  try {
    assertManagerAgentWorkspaceCapacity(
      statuses,
      sample.executionHostId,
      target.workspaceId,
      contact
    )
    assertManagerWorkspaceCapacity(db, sample.executionHostId, target.workspaceId)
  } catch (error) {
    if (error instanceof ManagerAuthorityError) {
      throw new ManagerCapacityUnavailableError(error.message)
    }
    throw error
  }
  assertManagerDispatchCapacity(db, reservation, account, sample, policy, statuses, Date.now())
  return { reservation, scope, run }
}
