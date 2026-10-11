import type { OrcaRuntimeService } from '../orca-runtime'
import { runLifecycleWriteTransaction } from '../orchestration/db/lifecycle-write-transaction-runner'
import { ManagerAuthorityError, ManagerCapacityUnavailableError } from './manager-authority-error'
import {
  sampleManagerDispatchResources,
  type ManagerResourceSample
} from './manager-dispatch-resource-sample'
import { checkManagerWorkerCapacity } from './manager-worker-capacity-check'
import { isWorkerDispatchTaskStartable } from '../orchestration/worker-dispatch-task-eligibility'
import {
  clearManagerDispatchWait,
  dispatchWaitRow,
  readManagerDispatchWaitTarget
} from './manager-dispatch-wait-store'

const draining = new WeakSet<OrcaRuntimeService>()

export async function recoverManagerDispatchWaits(
  runtime: OrcaRuntimeService,
  sampleHost = sampleManagerDispatchResources,
  stopped: () => boolean = () => false
): Promise<void> {
  const db = runtime.getExistingOrchestrationDb()
  if (!db || db.db.isTransaction || draining.has(runtime) || stopped()) {
    return
  }
  draining.add(runtime)
  try {
    const rows = db.db
      .prepare(
        "SELECT * FROM manager_dispatch_waits WHERE state = 'waiting' ORDER BY last_checked_at, created_at LIMIT 50"
      )
      .all()
    const samples = new Map<string, Promise<ManagerResourceSample>>()
    for (const value of rows) {
      if (stopped()) {
        return
      }
      const row = dispatchWaitRow.parse(value)
      db.db
        .prepare(
          'UPDATE manager_dispatch_waits SET last_checked_at = ? WHERE principal_id = ? AND request_id = ?'
        )
        .run(Date.now(), row.principal_id, row.request_id)
      try {
        const target = readManagerDispatchWaitTarget(row)
        const principal = db.managerPrincipals.authorize(row.principal_id, 'worker:start')
        db.managerRuns.requireOwnedRun(principal.id, db.getRun(target.runId), principal.grant.scope)
        const task = db.getTask(target.taskId)
        if (
          !task ||
          !isWorkerDispatchTaskStartable(db, task, target.retryOf) ||
          db.getMutationReceipt(`manager:${principal.id}`, row.request_id)
        ) {
          clearManagerDispatchWait(db, principal.id, row.request_id)
          continue
        }
        let pending = samples.get(row.execution_host_id)
        if (!pending) {
          pending = sampleHost(row.execution_host_id)
          samples.set(row.execution_host_id, pending)
        }
        const sample = await pending
        if (sample.executionHostId !== row.execution_host_id) {
          throw new ManagerCapacityUnavailableError('Resource sample placement is unverifiable')
        }
        if (stopped()) {
          return
        }
        runLifecycleWriteTransaction(db.db, 'manager_capacity_recovered', () => {
          const current = db.db
            .prepare(
              "SELECT * FROM manager_dispatch_waits WHERE principal_id = ? AND request_id = ? AND state = 'waiting'"
            )
            .get(principal.id, row.request_id)
          if (!current || dispatchWaitRow.parse(current).event_id !== row.event_id) {
            return
          }
          const { scope, run } = checkManagerWorkerCapacity(runtime, principal.id, target, sample)
          if (!run) {
            throw new Error('Capacity recovery Run is missing')
          }
          db.managerEvents.append({
            eventId: row.event_id,
            source: 'manager-capacity',
            sourceGeneration: `${principal.id}:${run.consumer_generation}`,
            kind: 'progress',
            scope: { ...scope, runId: run.id, actor: 'root' },
            occurredAt: Date.now(),
            summary:
              'A previously capacity-blocked Task is eligible for a fresh dispatch check. No worker has been launched.'
          })
          db.db
            .prepare(
              "UPDATE manager_dispatch_waits SET state = 'notified' WHERE principal_id = ? AND request_id = ?"
            )
            .run(principal.id, row.request_id)
        })
      } catch (error) {
        if (error instanceof ManagerCapacityUnavailableError) {
          continue
        }
        if (error instanceof ManagerAuthorityError) {
          clearManagerDispatchWait(db, row.principal_id, row.request_id)
          continue
        }
        throw error
      }
    }
  } finally {
    draining.delete(runtime)
  }
}

/** Daemon observations are bounded and only sample persisted waits; they never call a model. */
export function startManagerDispatchWaitRecovery(runtime: OrcaRuntimeService): () => void {
  let stopped = false
  const tick = () => {
    void recoverManagerDispatchWaits(runtime, sampleManagerDispatchResources, () => stopped).catch(
      () => {
        console.warn('[manager] Capacity observation failed; waits remain pending')
      }
    )
  }
  tick()
  const timer = setInterval(tick, 30_000)
  timer.unref()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
