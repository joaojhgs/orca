import type { ManagerConversationCall } from '../../../src/shared/manager-conversation-client'
import {
  ManagerConversationCreateParams,
  ManagerConversationListParams,
  ManagerConversationSendParams,
  ManagerConversationShowParams
} from '../../../src/shared/rpc-contract/manager-conversation-params'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import {
  managerConversationCreate,
  managerConversationRead,
  managerConversationSend,
  managerConversationsRead,
  managerPrincipalsRead
} from './mobile-manager-operations'

export class MobileManagerRefusalError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'MobileManagerRefusalError'
  }
}

const clientKeys = new WeakMap<RpcClient, number>()
let nextClientKey = 1
export function mobileManagerConnectionKey(client: RpcClient, ownerKey: string): string {
  let key = clientKeys.get(client)
  if (key === undefined) {
    key = nextClientKey++
    clientKeys.set(client, key)
  }
  return `${ownerKey}:${key}:${client.getGeneration?.() ?? 0}`
}

export function mobileManagerCall(
  client: RpcClient,
  isCurrent: () => boolean
): ManagerConversationCall {
  const generation = client.getGeneration?.()
  const requireCurrent = () => {
    if (
      !isCurrent() ||
      client.getGeneration?.() !== generation ||
      client.getState() !== 'connected'
    ) {
      throw new Error(
        'Controller connection changed. Reconnect and reconcile the saved manager request.'
      )
    }
  }
  const admit = <Value>(reply: RpcResponse, interpret: (reply: RpcResponse) => Value): Value => {
    requireCurrent()
    if (!reply.ok) {
      throw new MobileManagerRefusalError(reply.error.code, reply.error.message)
    }
    return interpret(reply)
  }
  return async (method, input) => {
    requireCurrent()
    switch (method) {
      case 'manager.principalsList':
        return admit(
          await managerPrincipalsRead.request(client, ManagerConversationListParams.parse(input)),
          managerPrincipalsRead.interpret
        )
      case 'manager.conversationsList':
        return admit(
          await managerConversationsRead.request(
            client,
            ManagerConversationListParams.parse(input)
          ),
          managerConversationsRead.interpret
        )
      case 'manager.conversationShow':
        return admit(
          await managerConversationRead.request(client, ManagerConversationShowParams.parse(input)),
          managerConversationRead.interpret
        )
      case 'manager.conversationCreate':
        return admit(
          await managerConversationCreate.request(
            client,
            ManagerConversationCreateParams.parse(input)
          ),
          managerConversationCreate.interpret
        )
      case 'manager.conversationSend':
        return admit(
          await managerConversationSend.request(client, ManagerConversationSendParams.parse(input)),
          managerConversationSend.interpret
        )
      default:
        throw new Error('Unsupported mobile manager conversation operation.')
    }
  }
}
