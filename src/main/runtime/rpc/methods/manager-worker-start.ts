import { createHash } from 'node:crypto'
import { z } from 'zod'
import { defineMethod } from '../core'
import { ManagerWorkerStartParams } from '../../../../shared/rpc-contract/manager-params'
import { requireManagerPrincipal } from '../../manager/manager-runtime-authority'
import {
  managerWorkerStartAuthority,
  resolveManagerWorkerPlacement
} from '../../manager/manager-worker-start-authority'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { startLocalWorker } from './orchestration/worker/local-worker-start'
import {
  decideWorkerStartMode,
  readWorkerStartModeSettings
} from './orchestration-worker-start-mode'
import { assertWorkerStartTaskSpecWithinPromptBudget } from './orchestration/worker/worker-start-prompt-budget'
import { sampleManagerDispatchResources } from '../../manager/manager-dispatch-resource-sample'
import { ManagerCapacityUnavailableError } from '../../manager/manager-authority-error'
import {
  assertManagerDispatchWaitInput,
  queueManagerDispatchWait
} from '../../manager/manager-dispatch-wait-store'

const acceptedReceipt = z.object({
  accepted: z.object({ taskId: z.string(), dispatchId: z.string() })
})

export const MANAGER_WORKER_START_METHODS = [
  defineMethod({
    name: 'manager.workerStart',
    permission: 'workspace',
    params: ManagerWorkerStartParams,
    handler: async (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requireManagerPrincipal(db, params.serviceToken, params.lease)
      db.managerPrincipals.withLease(params.lease, 'worker:start', () => undefined)
      const executionHostId = await resolveManagerWorkerPlacement(runtime, params)
      const authority = managerWorkerStartAuthority(runtime, params, executionHostId)
      const { run, task, scope } = authority.assertAuthority()
      if (!run) {
        throw new Error('Owned Run is missing')
      }
      const mutation = {
        callerFingerprint: `manager:${principal.id}`,
        requestId: params.requestId,
        method: 'manager.workerStart',
        payloadHash: createHash('sha256')
          .update(
            JSON.stringify({
              runId: params.runId,
              taskId: params.taskId,
              workspaceId: params.workspaceId,
              scope,
              executionHostId,
              agent: params.agent,
              model: params.model,
              effort: params.effort,
              retryOf: params.retryOf,
              workClass: params.workClass,
              timeoutMs: params.timeoutMs
            })
          )
          .digest('hex')
      }
      const previous = db.getMutationReceipt(mutation.callerFingerprint, mutation.requestId)
      if (previous) {
        if (previous.method !== mutation.method || previous.payload_hash !== mutation.payloadHash) {
          throw new OrchestrationError(
            'request_mismatch',
            'Worker request ID was already used with different input'
          )
        }
        if (previous.state === 'completed' && previous.receipt) {
          return JSON.parse(previous.receipt)
        }
        const accepted = acceptedReceipt.parse(JSON.parse(previous.receipt ?? 'null')).accepted
        return {
          ...accepted,
          runId: run.id,
          state: 'outcome_unknown',
          reconciliationRequired: true
        }
      }
      assertManagerDispatchWaitInput(db, principal.id, params.requestId, mutation.payloadHash)
      try {
        await assertWorkerStartTaskSpecWithinPromptBudget(task.spec)
        authority.prepareCapacity(await sampleManagerDispatchResources(executionHostId))
        authority.assertAuthority()
        const startParams = {
          from: `run:${run.id}`,
          run: run.id,
          task: task.id,
          worktree: `id:${params.workspaceId}`,
          agent: params.agent,
          model: params.model,
          effort: params.effort,
          retryOf: params.retryOf,
          timeoutMs: params.timeoutMs
        }
        const result = await startLocalWorker({
          params: startParams,
          runtime,
          db,
          run,
          coordinator: null,
          existingTask: task,
          orchestrationMutation: mutation,
          mode: decideWorkerStartMode({
            params: startParams,
            settings: readWorkerStartModeSettings(runtime)
          }),
          serviceOrigin: {
            workspaceId: params.workspaceId,
            scope,
            assertAuthority: authority.assertAuthority,
            assertPlacement: authority.assertPlacement,
            acceptDispatch: authority.acceptDispatch
          }
        })
        authority.assertAuthority()
        db.completeMutationReceipt({ ...mutation, receipt: JSON.stringify(result) })
        return result
      } catch (error) {
        if (error instanceof ManagerCapacityUnavailableError) {
          authority.assertAuthority()
          queueManagerDispatchWait(
            db,
            principal.id,
            params.requestId,
            mutation.payloadHash,
            executionHostId,
            {
              runId: params.runId,
              taskId: params.taskId,
              workspaceId: params.workspaceId,
              agent: params.agent,
              model: params.model,
              retryOf: params.retryOf,
              workClass: params.workClass
            }
          )
        }
        throw error
      }
    }
  })
]
