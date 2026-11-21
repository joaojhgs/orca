import { defineMethod } from '../core'
import {
  ManagerConversationPostParams,
  ManagerConversationReadParams
} from '../../../../shared/rpc-contract/manager-conversation-params'
import { ManagerConversationMessageSchema } from '../../../../shared/manager-conversation-contract'
import {
  appendManagerConversation,
  readManagerConversation
} from '../../manager/manager-conversation-messages'
import { requireManagerPrincipal } from '../../manager/manager-runtime-authority'
import { managerMutationReceipt } from '../../manager/manager-mutation-receipt'
import {
  tryDeliverPendingManagerQuestions,
  queueManagerQuestionNotification
} from '../../manager/manager-question-notifications'
import { ManagerAuthorityError } from '../../manager/manager-authority-error'
import {
  managerObjectiveSequence,
  verifyManagerCompletion
} from '../../manager/manager-completion-evidence'

export const MANAGER_CONVERSATION_SERVICE_METHODS = [
  defineMethod({
    name: 'manager.conversationRead',
    permission: 'workspace',
    params: ManagerConversationReadParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requireManagerPrincipal(db, params.serviceToken)
      const grant = db.managerPrincipals.authorize(principal.id, 'inventory:read').grant.scope
      const run = db.getRun(params.runId)
      db.managerRuns.requireOwnedRun(principal.id, run, grant)
      return {
        run,
        ...readManagerConversation(db, params.runId, params.afterSequence, params.limit)
      }
    }
  }),
  defineMethod({
    name: 'manager.conversationPost',
    permission: 'workspace',
    params: ManagerConversationPostParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requireManagerPrincipal(db, params.serviceToken, params.lease)
      const result = db.managerPrincipals.withLease(params.lease, 'conversation:write', () => {
        db.managerRuns.requireOwnedRun(principal.id, db.getRun(params.runId), principal.grant.scope)
        const message = managerMutationReceipt(
          db,
          principal.id,
          params.requestId,
          'manager.conversationPost',
          {
            runId: params.runId,
            body: params.body,
            replyTo: params.replyTo,
            kind: params.kind,
            completionEvidence: params.completionEvidence
          },
          (value) => ManagerConversationMessageSchema.parse(value),
          () => {
            if (params.completionEvidence && (params.kind !== 'reply' || params.replyTo)) {
              throw new ManagerAuthorityError(
                'manager_forbidden',
                'Completion must be a root result, not a question or answer'
              )
            }
            if (params.completionEvidence) {
              verifyManagerCompletion(db, params.runId, params.completionEvidence)
            }
            const message = appendManagerConversation(db, { ...params, role: 'manager' })
            if (params.completionEvidence) {
              const run = db.getRun(params.runId)
              if (!run) {
                throw new Error('Completion Run disappeared')
              }
              const verifiedAt = Date.now()
              db.db
                .prepare(`INSERT INTO manager_objective_completions
                (message_id, run_id, consumer_generation, objective_sequence, verified_at, evidence)
                VALUES (?, ?, ?, ?, ?, ?)`)
                .run(
                  message.id,
                  run.id,
                  run.consumer_generation,
                  managerObjectiveSequence(db, run.id),
                  verifiedAt,
                  JSON.stringify(params.completionEvidence)
                )
              queueManagerQuestionNotification(db, message.id)
              return { ...message, completion: { verifiedAt, evidence: params.completionEvidence } }
            }
            return message
          }
        )
        return { message, accepted: true }
      })
      tryDeliverPendingManagerQuestions(runtime)
      return result
    }
  })
]
