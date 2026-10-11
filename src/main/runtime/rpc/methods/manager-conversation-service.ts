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
import { tryDeliverPendingManagerQuestions } from '../../manager/manager-question-notifications'

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
          { runId: params.runId, body: params.body, replyTo: params.replyTo, kind: params.kind },
          (value) => ManagerConversationMessageSchema.parse(value),
          () => appendManagerConversation(db, { ...params, role: 'manager' })
        )
        return { message, accepted: true }
      })
      tryDeliverPendingManagerQuestions(runtime)
      return result
    }
  })
]
