import { z } from 'zod'
import { defineMethod } from '../core'
import { managerMayObserve } from '../../../../shared/manager-event-contract'
import {
  ManagerRunCreateParams,
  ManagerRunShowParams,
  ManagerTaskCreateParams
} from '../../../../shared/rpc-contract/manager-params'
import { ManagerAuthorityError } from '../../manager/manager-authority-error'
import { requireManagerPrincipal } from '../../manager/manager-runtime-authority'
import { resolveManagerWorkspaceScope } from '../../manager/manager-workspace-authority'
import { managerMutationReceipt } from '../../manager/manager-mutation-receipt'

const runReceipt = z.strictObject({ runId: z.string() })
const taskReceipt = z.strictObject({ taskId: z.string() })

export const MANAGER_WORK_METHODS = [
  defineMethod({
    name: 'manager.runCreate',
    permission: 'workspace',
    params: ManagerRunCreateParams,
    handler: async (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requireManagerPrincipal(db, params.serviceToken, params.lease)
      db.managerPrincipals.withLease(params.lease, 'run:create', () => undefined)
      const { workspace, scope } = await resolveManagerWorkspaceScope(runtime, params.workspaceId)
      return db.managerPrincipals.withLease(params.lease, 'run:create', () => {
        const grant = db.managerPrincipals.authorize(principal.id, 'run:create').grant.scope
        if (!managerMayObserve(grant, scope)) {
          throw new ManagerAuthorityError('manager_forbidden', 'Workspace is outside the grant')
        }
        const receipt = managerMutationReceipt(
          db,
          principal.id,
          params.requestId,
          'manager.runCreate',
          { workspaceId: workspace.id, scope, objective: params.objective },
          (value) => runReceipt.parse(value),
          () => {
            const run = db.createRun({
              objective: params.objective,
              coordinatorHandle: null,
              coordinatorPaneKey: null
            })
            db.managerRuns.registerCreatedRun(principal.id, run, scope)
            db.managerRuns.observationGrant(principal.id, grant)
            return { runId: run.id }
          }
        )
        const run = db.getRun(receipt.runId)
        db.managerRuns.requireOwnedRun(principal.id, run, grant)
        return { run, scope, ownership: 'service-principal' as const }
      })
    }
  }),
  defineMethod({
    name: 'manager.runShow',
    permission: 'workspace',
    params: ManagerRunShowParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requireManagerPrincipal(db, params.serviceToken)
      const grant = db.managerPrincipals.authorize(principal.id, 'inventory:read').grant.scope
      const run = db.getRun(params.runId)
      const scope = db.managerRuns.requireOwnedRun(principal.id, run, grant)
      return { run, scope, ownership: 'service-principal' as const }
    }
  }),
  defineMethod({
    name: 'manager.taskCreate',
    permission: 'workspace',
    params: ManagerTaskCreateParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requireManagerPrincipal(db, params.serviceToken, params.lease)
      return db.managerPrincipals.withLease(params.lease, 'task:write', () => {
        const grant = db.managerPrincipals.authorize(principal.id, 'task:write').grant.scope
        db.managerRuns.requireOwnedRun(principal.id, db.getRun(params.runId), grant)
        const input = {
          runId: params.runId,
          spec: params.spec,
          taskTitle: params.taskTitle,
          deps: params.deps,
          parentId: params.parentId
        }
        const receipt = managerMutationReceipt(
          db,
          principal.id,
          params.requestId,
          'manager.taskCreate',
          input,
          (value) => taskReceipt.parse(value),
          () => ({ taskId: db.createTask(input).id })
        )
        const task = db.getTask(receipt.taskId)
        if (!task || task.run_id !== params.runId) {
          throw new Error('Manager task receipt needs reconciliation')
        }
        return { task }
      })
    }
  })
]
