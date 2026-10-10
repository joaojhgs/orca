import {
  ManagerConversationAcceptedSchema,
  ManagerConversationCatalogSchema,
  ManagerConversationCreatedSchema,
  ManagerConversationDetailSchema,
  ManagerPrincipalPageSchema,
  type ManagerConversationMessage,
  type ManagerPublicPrincipal
} from './manager-conversation-contract'
import {
  ManagerConversationCreateParams,
  ManagerConversationSendParams
} from './rpc-contract/manager-conversation-params'

export type ManagerConversationCall = (method: string, params: unknown) => Promise<unknown>

export async function readManagerConversationCatalog(call: ManagerConversationCall, offset = 0) {
  const [principals, conversations] = await Promise.all([
    readManagerPrincipals(call),
    call('manager.conversationsList', { offset, limit: 50 })
  ])
  const catalog = ManagerConversationCatalogSchema.parse(conversations)
  if (catalog.nextOffset !== null && catalog.nextOffset <= offset) {
    throw new Error('Manager conversation pagination did not advance.')
  }
  return {
    ...catalog,
    principals
  }
}

async function readManagerPrincipals(call: ManagerConversationCall) {
  const principals: ManagerPublicPrincipal[] = []
  let offset = 0
  for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
    const page = ManagerPrincipalPageSchema.parse(
      await call('manager.principalsList', { offset, limit: 100 })
    )
    principals.push(...page.principals)
    if (page.nextOffset === null) {
      return principals
    }
    if (page.nextOffset <= offset) {
      throw new Error('Manager catalog pagination did not advance.')
    }
    offset = page.nextOffset
  }
  throw new Error(
    'Manager catalog exceeds this client’s bounded listing. Narrow the configured managers.'
  )
}

export async function readManagerConversationPage(
  call: ManagerConversationCall,
  runId: string,
  afterSequence = 0
) {
  const page = ManagerConversationDetailSchema.parse(
    await call('manager.conversationShow', { runId, afterSequence, limit: 50 })
  )
  if (
    page.run.id !== runId ||
    page.messages.some(
      (message, index) =>
        message.runId !== runId ||
        message.sequence <= (page.messages[index - 1]?.sequence ?? afterSequence)
    ) ||
    page.nextSequence !== (page.messages.at(-1)?.sequence ?? afterSequence) ||
    (page.hasMore && page.messages.length === 0)
  ) {
    throw new Error('Manager conversation history needs reconciliation; refresh before continuing.')
  }
  return page
}

export function mergeManagerConversationMessages(
  previous: readonly ManagerConversationMessage[],
  incoming: readonly ManagerConversationMessage[]
): ManagerConversationMessage[] {
  const byId = new Map(previous.map((message) => [message.id, message]))
  for (const message of incoming) {
    byId.set(message.id, message)
  }
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence)
}

export async function createManagerConversation(call: ManagerConversationCall, input: unknown) {
  const params = ManagerConversationCreateParams.parse(input)
  return ManagerConversationCreatedSchema.parse(await call('manager.conversationCreate', params))
}

export async function sendManagerConversationMessage(
  call: ManagerConversationCall,
  input: unknown
) {
  const params = ManagerConversationSendParams.parse(input)
  return ManagerConversationAcceptedSchema.parse(await call('manager.conversationSend', params))
}
