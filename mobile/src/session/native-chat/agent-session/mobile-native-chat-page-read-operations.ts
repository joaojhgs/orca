import type { RpcClient } from '../../../transport/rpc/rpc-client-contract'
import { bindDeferredRpcOperation, defineRpcOperation } from '../../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../../transport/rpc/rpc-operation-result-reader'
import '../../../terminal/host-operations/terminal-reply-schema'
import { sessionForwardedReplySchema } from '../../../transport/rpc/rpc-uninterpreted-reply-schemas'

// Retain the live window on refusal and let the caller offer retry; read the whole legacy error/window union before selecting messages.
const nativeChatSessionPageRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'nativeChat.read-session-page-or-skip',
    method: 'nativeChat.readSession',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('native-chat-session-page', sessionForwardedReplySchema)
  })
)

export const NATIVE_CHAT_TRANSCRIPT_MAX_MESSAGES = 2000

export function nextNativeChatPageWindow(limit: number, listLength: number) {
  // Live appends may have grown the transcript since the last read.
  const held = Math.max(limit, listLength)
  const nextLimit = Math.min(held + 60, NATIVE_CHAT_TRANSCRIPT_MAX_MESSAGES)
  return nextLimit > held ? { nextLimit, pageLimit: nextLimit - held } : null
}

export async function readMobileNativeChatSessionPage(
  client: RpcClient,
  args: {
    agent: string
    sessionId: string
    limit: number
    beforeOffset: number | null
    transcriptPath: string | null
    executionHostId?: string | null
  },
  timeoutMs: number
): Promise<unknown> {
  const { agent, sessionId, limit, beforeOffset, transcriptPath, executionHostId } = args
  const response = await nativeChatSessionPageRead.request(
    client,
    {
      agent,
      sessionId,
      limit,
      capabilities: { transcriptSourceOrder: 1 },
      ...(beforeOffset === null ? {} : { beforeOffset }),
      ...(transcriptPath ? { transcriptPath } : {}),
      ...(executionHostId ? { executionHostId } : {})
    },
    { timeoutMs, budgetSpansConnect: true }
  )
  const accepted = nativeChatSessionPageRead.interpret(response)
  return accepted.accepted ? accepted.value : undefined
}
