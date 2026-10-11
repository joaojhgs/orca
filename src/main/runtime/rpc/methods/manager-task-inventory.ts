import { defineMethod } from '../core'
import {
  ManagerRunListParams,
  ManagerTaskListParams,
  ManagerTaskShowParams
} from '../../../../shared/rpc-contract/manager-params'
import { requireManagerPrincipal } from '../../manager/manager-runtime-authority'
import { ManagerAuthorityError } from '../../manager/manager-authority-error'
import type { OrchestrationDb } from '../../orchestration/db'
import { exposeDispatchContext } from './orchestration/worker/worker-observation'
import { readManagerTaskRequirements } from '../../manager/manager-completion-evidence'

function requireRun(db: OrchestrationDb, serviceToken: string, runId: string) {
  const principal = requireManagerPrincipal(db, serviceToken)
  const grant = db.managerPrincipals.authorize(principal.id, 'inventory:read').grant.scope
  db.managerRuns.requireOwnedRun(principal.id, db.getRun(runId), grant)
}

export const MANAGER_TASK_INVENTORY_METHODS = [
  defineMethod({
    name: 'manager.runList',
    permission: 'workspace',
    params: ManagerRunListParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requireManagerPrincipal(db, params.serviceToken)
      const grant = db.managerPrincipals.authorize(principal.id, 'inventory:read').grant.scope
      const owned = db.managerRuns.ownedScopes(principal.id, grant)
      const rows = owned
        .slice(params.offset, params.offset + params.limit)
        .map(({ runId, scope }) => {
          const run = db.getRun(runId)
          if (!run) {
            throw new Error('Owned Run disappeared during inventory')
          }
          return { run, scope, ownership: 'service-principal' as const }
        })
      return {
        runs: rows,
        nextOffset: params.offset + rows.length < owned.length ? params.offset + rows.length : null,
        observedAt: Date.now()
      }
    }
  }),
  defineMethod({
    name: 'manager.taskList',
    permission: 'workspace',
    params: ManagerTaskListParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      requireRun(db, params.serviceToken, params.runId)
      const rows = db.listTasks({
        runId: params.runId,
        limit: params.limit + 1,
        offset: params.offset
      })
      const tasks = rows.slice(0, params.limit).map((task) => ({
        id: task.id,
        runId: task.run_id,
        parentId: task.parent_id,
        title: task.task_title,
        status: task.status,
        createdAt: task.created_at,
        completedAt: task.completed_at,
        dispatchId: db.getDispatchContext(task.id)?.id ?? null
      }))
      return {
        tasks,
        nextOffset: rows.length > params.limit ? params.offset + params.limit : null,
        observedAt: Date.now()
      }
    }
  }),
  defineMethod({
    name: 'manager.taskShow',
    permission: 'workspace',
    params: ManagerTaskShowParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      requireRun(db, params.serviceToken, params.runId)
      const task = db.getTask(params.taskId)
      if (!task || task.run_id !== params.runId) {
        throw new ManagerAuthorityError('manager_forbidden', 'Task is not in the addressed Run')
      }
      const dispatch = db.getDispatchContext(task.id)
      return {
        task,
        completionRequirements: readManagerTaskRequirements(db, task.id),
        reportFacts: dispatch
          ? db
              .getAttemptObservationFacts(dispatch.id)
              .filter((fact) => fact.facet === 'worker_report')
          : [],
        dispatch: dispatch ? exposeDispatchContext(dispatch) : null,
        observedAt: Date.now()
      }
    }
  })
]
