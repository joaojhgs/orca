import {
  ManagerConversationAcceptedSchema,
  ManagerConversationCatalogSchema,
  ManagerConversationCreatedSchema,
  ManagerConversationDetailSchema,
  ManagerPrincipalPageSchema
} from '../../../src/shared/manager-conversation-contract'
import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import { rpcResultVariant } from '../transport/rpc-operation-result-reader'

export const managerPrincipalsRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'manager.principals-list',
    method: 'manager.principalsList',
    acceptance: 'require-result-or-throw',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('manager-principals', ManagerPrincipalPageSchema)
  })
)
export const managerConversationsRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'manager.conversations-list',
    method: 'manager.conversationsList',
    acceptance: 'require-result-or-throw',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('manager-conversations', ManagerConversationCatalogSchema)
  })
)
export const managerConversationRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'manager.conversation-show',
    method: 'manager.conversationShow',
    acceptance: 'require-result-or-throw',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('manager-conversation', ManagerConversationDetailSchema)
  })
)
export const managerConversationCreate = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'manager.conversation-create',
    method: 'manager.conversationCreate',
    acceptance: 'require-result-or-throw',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('manager-created', ManagerConversationCreatedSchema)
  })
)
export const managerConversationSend = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'manager.conversation-send',
    method: 'manager.conversationSend',
    acceptance: 'require-result-or-throw',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('manager-message-queued', ManagerConversationAcceptedSchema)
  })
)
