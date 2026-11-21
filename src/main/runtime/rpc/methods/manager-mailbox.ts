import { z } from 'zod'
import { defineMethod } from '../core'
import {
  ManagerMailboxCheckParams,
  ManagerMailboxAckParams,
  ManagerWorkerGuideParams,
  ManagerQuestionAnswerParams
} from '../../../../shared/rpc-contract/manager-params'
import { requireManagerPrincipal } from '../../manager/manager-runtime-authority'
import { requireManagerWorker } from '../../manager/manager-worker-authority'
import { managerMutationReceipt } from '../../manager/manager-mutation-receipt'
import { ManagerAuthorityError } from '../../manager/manager-authority-error'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { exposeMessages } from './orchestration/messaging/mailbox-message-receipt'

const messageReceipt = z.object({ messageId: z.string(), accepted: z.literal(true) })

export const MANAGER_MAILBOX_METHODS = [
  defineMethod({
    name: 'manager.mailboxCheck',
    permission: 'workspace',
    params: ManagerMailboxCheckParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requireManagerPrincipal(db, params.serviceToken, params.lease)
      return db.managerPrincipals.withLease(params.lease, 'inventory:read', () => {
        const run = db.getRun(params.runId)
        db.managerRuns.requireOwnedRun(principal.id, run, principal.grant.scope)
        if (!run) {
          throw new Error('Owned Run is missing')
        }
        const batch = db.getOrCreateRunDelivery({
          runId: run.id,
          consumerGeneration: run.consumer_generation,
          limit: params.limit
        })
        return {
          runId: run.id,
          deliveryId: batch?.delivery.id ?? null,
          messages: exposeMessages(batch?.messages ?? []),
          replayed: batch?.replayed ?? false
        }
      })
    }
  }),
  defineMethod({
    name: 'manager.mailboxAck',
    permission: 'workspace',
    params: ManagerMailboxAckParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requireManagerPrincipal(db, params.serviceToken, params.lease)
      return db.managerPrincipals.withLease(params.lease, 'events:checkpoint', () => {
        const run = db.getRun(params.runId)
        db.managerRuns.requireOwnedRun(principal.id, run, principal.grant.scope)
        if (!run) {
          throw new Error('Owned Run is missing')
        }
        const acknowledged = db.acknowledgeRunDelivery({
          runId: run.id,
          consumerGeneration: run.consumer_generation,
          deliveryId: params.deliveryId
        })
        return {
          deliveryId: acknowledged.delivery.id,
          acknowledged: true,
          duplicate: acknowledged.duplicate
        }
      })
    }
  }),
  defineMethod({
    name: 'manager.workerGuide',
    permission: 'workspace',
    params: ManagerWorkerGuideParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requireManagerPrincipal(db, params.serviceToken, params.lease)
      const receipt = db.managerPrincipals.withLease(params.lease, 'worker:guide', () => {
        const dispatch = requireManagerWorker(runtime, params, 'worker:guide')
        if (db.getFederatedDispatch(dispatch.id)) {
          throw new ManagerAuthorityError(
            'manager_forbidden',
            'Managed-server guidance is not confirmed; no local fallback'
          )
        }
        if (!['pending', 'dispatched'].includes(dispatch.status)) {
          throw new OrchestrationError(
            'dispatch_inactive',
            'Worker guidance requires an active Dispatch'
          )
        }
        return managerMutationReceipt(
          db,
          principal.id,
          params.requestId,
          'manager.workerGuide',
          { runId: params.runId, dispatchId: dispatch.id, body: params.body },
          (value) => messageReceipt.parse(value),
          () => {
            const message = db.insertMessage({
              from: `run:${params.runId}`,
              to: `dispatch:${dispatch.id}`,
              runId: params.runId,
              type: 'status',
              subject: 'Manager follow-up',
              body: params.body
            })
            return { messageId: message.id, accepted: true as const }
          }
        )
      })
      runtime.notifyMessageArrived(`dispatch:${params.dispatchId}`, 'status')
      return { ...receipt, delivery: 'queued' as const }
    }
  }),
  defineMethod({
    name: 'manager.questionAnswer',
    permission: 'workspace',
    params: ManagerQuestionAnswerParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requireManagerPrincipal(db, params.serviceToken, params.lease)
      const question = db.getQuestion(params.messageId)
      if (!question || question.run_id !== params.runId) {
        throw new ManagerAuthorityError('manager_forbidden', 'Question is not in the addressed Run')
      }
      const receipt = db.managerPrincipals.withLease(params.lease, 'question:answer', () => {
        const run = db.getRun(params.runId)
        db.managerRuns.requireOwnedRun(principal.id, run, principal.grant.scope)
        const dispatch = requireManagerWorker(
          runtime,
          { ...params, dispatchId: question.dispatch_id },
          'question:answer'
        )
        if (db.getFederatedDispatch(dispatch.id)) {
          throw new ManagerAuthorityError(
            'manager_forbidden',
            'Managed-server answers are not confirmed; no local fallback'
          )
        }
        if (!run) {
          throw new Error('Owned Run is missing')
        }
        return managerMutationReceipt(
          db,
          principal.id,
          params.requestId,
          'manager.questionAnswer',
          { runId: run.id, messageId: params.messageId, body: params.body },
          (value) => messageReceipt.parse(value),
          () => {
            const answer = db.answerQuestion({
              messageId: params.messageId,
              runId: run.id,
              consumerGeneration: run.consumer_generation,
              body: params.body
            })
            return { messageId: answer.message.id, accepted: true as const }
          }
        )
      })
      runtime.notifyMessageArrived(`dispatch:${question.dispatch_id}`, 'status')
      return receipt
    }
  })
]
