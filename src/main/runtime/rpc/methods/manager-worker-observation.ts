import { defineMethod } from '../core'
import {
  ManagerWorkerReadParams,
  ManagerWorkerShowParams
} from '../../../../shared/rpc-contract/manager-params'
import { requireManagerWorker } from '../../manager/manager-worker-authority'
import { ORCHESTRATION_WORKER_CONTROL_METHODS } from './orchestration/worker/worker-control'

const show = ORCHESTRATION_WORKER_CONTROL_METHODS.find(
  (method) => method.name === 'orchestration.workerShow'
)
const read = ORCHESTRATION_WORKER_CONTROL_METHODS.find(
  (method) => method.name === 'orchestration.workerRead'
)
if (!show || !read) {
  throw new Error('Existing worker observation methods are missing')
}
const workerShow = show
const workerRead = read

export const MANAGER_WORKER_OBSERVATION_METHODS = [
  defineMethod({
    name: 'manager.workerShow',
    permission: 'workspace',
    params: ManagerWorkerShowParams,
    handler: async (params, context) => {
      requireManagerWorker(context.runtime, params)
      const result = await workerShow.handler({ dispatch: params.dispatchId }, context)
      requireManagerWorker(context.runtime, params)
      return result
    }
  }),
  defineMethod({
    name: 'manager.workerRead',
    permission: 'workspace',
    params: ManagerWorkerReadParams,
    handler: async (params, context) => {
      requireManagerWorker(context.runtime, params)
      const result = await workerRead.handler(
        {
          dispatch: params.dispatchId,
          source: params.source,
          cursor: params.cursor,
          limit: params.limit
        },
        context
      )
      requireManagerWorker(context.runtime, params)
      return result
    }
  })
]
