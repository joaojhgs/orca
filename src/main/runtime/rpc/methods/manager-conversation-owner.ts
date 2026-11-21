import { z } from 'zod'
import { defineMethod } from '../core'
import { managerMayObserve } from '../../../../shared/manager-event-contract'
import {
  ManagerConversationCreateParams,
  ManagerConversationListParams,
  ManagerConversationSendParams,
  ManagerConversationShowParams
} from '../../../../shared/rpc-contract/manager-conversation-params'
import { ManagerAuthorityError } from '../../manager/manager-authority-error'
import { resolveManagerWorkspaceScope } from '../../manager/manager-workspace-authority'
import { managerMutationReceipt } from '../../manager/manager-mutation-receipt'
import {
  appendManagerConversation,
  readManagerConversation
} from '../../manager/manager-conversation-messages'
import { runLifecycleWriteTransaction } from '../../orchestration/db/lifecycle-write-transaction-runner'

const createReceipt = z.object({ runId: z.string() })
const sendReceipt = z.object({ messageId: z.string() })

export const MANAGER_CONVERSATION_OWNER_METHODS = [
  defineMethod({
    name: 'manager.principalsList',
    permission: 'host-admin',
    params: ManagerConversationListParams,
    handler: (params, { runtime }) =>
      runtime.getOrchestrationDb().managerPrincipals.listPublic(params.offset, params.limit)
  }),
  defineMethod({
    name: 'manager.conversationsList',
    permission: 'host-admin',
    params: ManagerConversationListParams,
    handler: (params, { runtime }) =>
      runtime.getOrchestrationDb().managerRuns.listConversations(params.offset, params.limit)
  }),
  defineMethod({
    name: 'manager.conversationCreate',
    permission: 'host-admin',
    params: ManagerConversationCreateParams,
    handler: async (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      db.managerPrincipals.authorize(params.principalId, 'run:create')
      const { workspace, scope } = await resolveManagerWorkspaceScope(runtime, params.workspaceId)
      return runLifecycleWriteTransaction(db.db, 'manager_human_objective', () => {
        const principal = db.managerPrincipals.authorize(params.principalId, 'run:create')
        if (!managerMayObserve(principal.grant.scope, scope)) {
          throw new ManagerAuthorityError('manager_forbidden', 'Workspace is outside manager grant')
        }
        const receipt = managerMutationReceipt(
          db,
          `human:${principal.id}`,
          params.requestId,
          'manager.conversationCreate',
          { workspaceId: workspace.id, objective: params.objective, scope },
          (value) => createReceipt.parse(value),
          () => {
            const run = db.createRun({
              objective: params.objective,
              coordinatorHandle: null,
              coordinatorPaneKey: null
            })
            db.managerRuns.registerCreatedRun(principal.id, run, scope)
            appendManagerConversation(db, {
              runId: run.id,
              role: 'human',
              kind: 'reply',
              body: params.objective
            })
            return { runId: run.id }
          }
        )
        const run = db.getRun(receipt.runId)
        db.managerRuns.requireOwnedRun(principal.id, run, principal.grant.scope)
        return { run, scope, ...readManagerConversation(db, receipt.runId, 0, 50) }
      })
    }
  }),
  defineMethod({
    name: 'manager.conversationShow',
    permission: 'host-admin',
    params: ManagerConversationShowParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const run = db.getRun(params.runId)
      const principalId = db.managerRuns.principalForRun(run)
      return {
        run,
        principalId,
        ...readManagerConversation(db, params.runId, params.afterSequence, params.limit)
      }
    }
  }),
  defineMethod({
    name: 'manager.conversationSend',
    permission: 'host-admin',
    params: ManagerConversationSendParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      return runLifecycleWriteTransaction(db.db, 'manager_human_message', () => {
        const run = db.getRun(params.runId)
        const principalId = db.managerRuns.principalForRun(run)
        const grant = db.managerPrincipals.authorize(principalId, 'inventory:read').grant.scope
        db.managerRuns.requireOwnedRun(principalId, run, grant)
        const receipt = managerMutationReceipt(
          db,
          `human:${principalId}`,
          params.requestId,
          'manager.conversationSend',
          { runId: params.runId, body: params.body, replyTo: params.replyTo },
          (value) => sendReceipt.parse(value),
          () => ({
            messageId: appendManagerConversation(db, {
              ...params,
              role: 'human',
              kind: 'reply'
            }).id
          })
        )
        return { ...receipt, accepted: true, delivery: 'queued' as const }
      })
    }
  })
]
