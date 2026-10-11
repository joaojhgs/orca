import type { OrchestrationDb } from './db'
import type { TaskRow } from './types'

/** Retry admission and durable capacity observations share the canonical start rules. */
export function isWorkerDispatchTaskStartable(
  db: OrchestrationDb,
  task: TaskRow,
  retryOf?: string
): boolean {
  if (!retryOf) {
    return task.status === 'ready'
  }
  const prior = db.getDispatchContextById(retryOf)
  const priorWorker = db.getWorkerDispatch(retryOf)
  const latest = db.getDispatchContext(task.id)
  const priorSettled = priorWorker
    ? ['failed', 'stopped', 'abandoned'].includes(priorWorker.state)
    : prior?.status === 'failed'
  return Boolean(
    prior &&
    prior.task_id === task.id &&
    latest?.id === prior.id &&
    priorSettled &&
    ['failed', 'blocked'].includes(task.status)
  )
}
