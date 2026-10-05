import { describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { buildRegistry, isStreamingMethod, type RpcContext } from '../core'
import { NATIVE_CHAT_METHODS } from './native-chat'

const remote = vi.hoisted(() => ({
  read: vi.fn(),
  subscribe: vi.fn(),
  stop: vi.fn()
}))
vi.mock('../../../providers/ssh-filesystem-dispatch', () => ({
  getSshFilesystemProvider: () => ({ readFile: vi.fn() })
}))
vi.mock('../../../native-chat/remote-transcript-reader', () => ({
  readRemoteTranscriptTail: remote.read,
  subscribeRemoteTranscript: remote.subscribe
}))
vi.mock('../../../native-chat/transcript-watch', () => ({
  readNativeChatTranscriptTail: vi.fn(),
  subscribeNativeChatTranscript: vi.fn()
}))

function page(): NativeChatMessage[] {
  return ['reasoning', 'assistant'].map((role, index) => ({
    id: `remote-${index}`,
    role: role === 'reasoning' ? 'reasoning' : 'assistant',
    timestamp: 1,
    source: 'transcript',
    blocks: [{ type: 'text', text: role }]
  }))
}

function context(): RpcContext {
  const runtime = { registerSubscriptionCleanup: vi.fn(), cleanupSubscription: vi.fn() }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Remote transcript methods only use these two runtime subscription hooks.
  return { runtime: runtime as unknown as RpcContext['runtime'], clientKind: 'runtime' }
}

describe('merged SSH transcript paging', () => {
  it('keeps an entire OpenCode semantic group in remote read and subscription pages', async () => {
    const result = { messages: page(), hasMore: true, beforeOffset: 7 }
    remote.read.mockResolvedValue(result)
    remote.subscribe.mockImplementation(async (args) => {
      args.onResult(result, true)
      args.onResult(result, false)
      return remote.stop
    })
    const registry = buildRegistry(NATIVE_CHAT_METHODS)
    const read = registry.get('nativeChat.readSession')!
    const subscribe = registry.get('nativeChat.subscribe')!
    if (isStreamingMethod(read) || !isStreamingMethod(subscribe)) {
      throw new Error('Unexpected native chat method kind')
    }
    const params = {
      agent: 'opencode',
      sessionId: 'remote-session',
      executionHostId: 'ssh:personal',
      transcriptPath: '/home/developer/transcript.jsonl',
      limit: 1
    }
    expect(await read.handler(read.params?.parse(params), context())).toEqual(result)
    const emit = vi.fn()
    await subscribe.handler(subscribe.params?.parse(params), context(), emit)
    expect(emit).toHaveBeenNthCalledWith(1, { type: 'snapshot', ...result })
    expect(emit).toHaveBeenNthCalledWith(2, { type: 'replacement', ...result })
    expect(remote.read).toHaveBeenCalledWith(
      expect.objectContaining({
        path: params.transcriptPath,
        limit: 1,
        agent: 'opencode'
      })
    )
  })
})
