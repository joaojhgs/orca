import {
  MOBILE_NATIVE_CHAT_DEFAULT_WINDOW,
  pageForClient,
  resumeIndex,
  sanitizeAppendForClient
} from './native-chat-rpc-transcript-page'
import { recordMobileViewOpened } from '../../../../telemetry/mobile-client-telemetry'
import type { NativeChatTranscriptFrame } from '../../../../../shared/native-chat/transcript/streaming/native-chat-transcript-frames'
import { resolveNativeChatTranscriptAgent } from '../../../../../shared/native-chat/native-chat-agent-support'
import { subscribeNativeChatTranscript } from '../../../../native-chat/transcript-watch'
import { readNativeChatTranscriptTail } from '../../../../native-chat/transcript-tail-reader'
import type {
  NativeChatTranscriptSubscription,
  SubscribeNativeChatTranscriptArgs
} from '../../../../native-chat/transcript-watching/transcript-watch-contract'
import { nativeChatTranscriptPathOnExecutionHost } from '../../../../native-chat/transcript-filesystem/ssh-transcript-path'
import { defineMethod, defineStreamingMethod } from '../../core'
import { isRemoteTranscriptHost, remoteTranscriptProvider } from '../native-chat-transcript-host'
import {
  readRemoteTranscriptTail,
  subscribeRemoteTranscript
} from '../../../../native-chat/remote-transcript-reader'
import { nativeChatRpcAppendBatches } from './native-chat-rpc-page-bounds'
import {
  NativeChatSession,
  NativeChatUnsubscribe
} from '../../../../../shared/rpc-contract/native-chat/native-chat-params'

export const NATIVE_CHAT_METHODS = [
  defineMethod({
    name: 'nativeChat.readSession',
    permission: 'workspace',
    params: NativeChatSession,
    handler: async (params, { runtime, clientKind, signal }) => {
      const limit = params.limit ?? MOBILE_NATIVE_CHAT_DEFAULT_WINDOW
      const remoteProvider = isRemoteTranscriptHost(params.executionHostId)
        ? remoteTranscriptProvider(params.executionHostId)
        : null
      const result = isRemoteTranscriptHost(params.executionHostId)
        ? remoteProvider && params.transcriptPath
          ? await readRemoteTranscriptTail({
              provider: remoteProvider,
              path: params.transcriptPath,
              agent: params.agent,
              limit,
              beforeOffset: params.beforeOffset
            })
          : { error: 'Remote transcript unavailable' }
        : await readNativeChatTranscriptTail(
            {
              agent: params.agent,
              sessionId: params.sessionId,
              transcriptPath: nativeChatTranscriptPathOnExecutionHost(
                runtime.getAgentProviderSessionRows(),
                params.sessionId,
                params.transcriptPath
              ),
              limit,
              beforeOffset: params.beforeOffset,
              sourceOrder: params.capabilities?.transcriptSourceOrder === 1
            },
            signal
          )
      return 'messages' in result
        ? {
            ...pageForClient(
              result.messages,
              result.hasMore,
              result.beforeOffset,
              clientKind,
              limit,
              params.agent
            ),
            ...(result.lifecycle ? { lifecycle: result.lifecycle } : {})
          }
        : result
    }
  }),
  defineStreamingMethod({
    name: 'nativeChat.subscribe',
    permission: 'workspace',
    params: NativeChatSession,
    handler: async (
      params,
      { runtime, connectionId, clientKind, pairedDeviceId, signal },
      emitAny
    ) => {
      const emit = (frame: NativeChatTranscriptFrame): void => emitAny(frame)
      if (signal?.aborted) {
        return
      }
      let closed = false
      let unsubscribe = (): void => {}
      const setupController = new AbortController()
      // Drain a bounded tail first, then appended turns merged by id. Use the supplied cleanup token or legacy agent:sessionId so unsubscribe matches.
      const cleanupToken = params.subscriptionId ?? `${params.agent}:${params.sessionId}`
      const subscriptionId = `nativeChat:${connectionId ?? 'local'}:${cleanupToken}`
      const limit = params.limit ?? MOBILE_NATIVE_CHAT_DEFAULT_WINDOW
      const cleanup = (): void => {
        if (closed) {
          return
        }
        closed = true
        signal?.removeEventListener('abort', handleAbort)
        setupController.abort()
        unsubscribe()
        emit({ type: 'end' })
      }
      function handleAbort(): void {
        runtime.cleanupSubscription(subscriptionId)
      }
      signal?.addEventListener('abort', handleAbort, { once: true })
      runtime.registerSubscriptionCleanup(subscriptionId, cleanup, connectionId)
      if (signal?.aborted) {
        runtime.cleanupSubscription(subscriptionId)
        return
      }
      if (closed) {
        return
      }
      if (isRemoteTranscriptHost(params.executionHostId)) {
        const provider = remoteTranscriptProvider(params.executionHostId)
        if (!provider || !params.transcriptPath) {
          emit({
            type: 'snapshot',
            messages: [],
            hasMore: false,
            error: 'Remote transcript unavailable'
          })
          return
        }
        const stopRemote = await subscribeRemoteTranscript({
          provider,
          path: params.transcriptPath,
          agent: params.agent,
          limit,
          onResult: (result, first) => {
            if (!closed) {
              emit({
                type: first ? 'snapshot' : 'replacement',
                ...pageForClient(
                  result.messages,
                  result.hasMore,
                  result.beforeOffset,
                  clientKind,
                  limit,
                  params.agent
                ),
                ...(result.lifecycle ? { lifecycle: result.lifecycle } : {})
              })
            }
          },
          onInitialError: (error) => {
            if (!closed) {
              emit({ type: 'snapshot', messages: [], hasMore: false, error })
            }
          }
        })
        if (closed) {
          stopRemote()
        } else {
          unsubscribe = stopRemote
        }
        return
      }
      const subscribeArgs: SubscribeNativeChatTranscriptArgs = {
        agent: params.agent,
        sessionId: params.sessionId,
        transcriptPath: nativeChatTranscriptPathOnExecutionHost(
          runtime.getAgentProviderSessionRows(),
          params.sessionId,
          params.transcriptPath
        ),
        initialLimit: limit,
        sourceOrder: params.capabilities?.transcriptSourceOrder === 1,
        onInitialSnapshot: (messages, hasMore, beforeOffset, error, lifecycle) => {
          if (closed) {
            return
          }
          const resumeAt = resumeIndex(messages, params.resumeAfter, params.agent)
          const resumed = resumeAt !== -1
          // Emit initial-read errors so a watching view cannot remain loading forever.
          emit({
            type: 'snapshot',
            ...pageForClient(
              resumed ? messages.slice(resumeAt) : messages,
              resumeAt > 0 || hasMore,
              resumed ? messages[resumeAt].transcriptOrder! : beforeOffset,
              clientKind,
              limit,
              params.agent
            ),
            ...(resumed ? { resumed } : {}),
            ...(error ? { error } : {}),
            ...(lifecycle ? { lifecycle } : {})
          })
        },
        ...(params.capabilities?.transcriptPending === 1
          ? {
              onTranscriptPending: () => {
                if (!closed) {
                  emit({ type: 'snapshot', messages: [], hasMore: false, pending: true })
                }
              }
            }
          : {}),
        onReplace: (messages, hasMore, beforeOffset, lifecycle) => {
          if (closed) {
            return
          }
          emit({
            type: 'replacement',
            ...pageForClient(messages, hasMore, beforeOffset, clientKind, limit, params.agent),
            ...(lifecycle ? { lifecycle } : {})
          })
        },
        onAppend: (messages, lifecycle) => {
          if (closed) {
            return
          }
          const sanitized = sanitizeAppendForClient(messages, clientKind)
          const batches =
            sanitized.length > 0 && resolveNativeChatTranscriptAgent(params.agent) === 'opencode'
              ? nativeChatRpcAppendBatches(sanitized)
              : [sanitized]
          for (const batch of batches) {
            emit({
              type: 'appended',
              messages: batch,
              ...(lifecycle && batch === batches.at(-1) ? { lifecycle } : {})
            })
          }
        }
      }
      let subscription: NativeChatTranscriptSubscription
      try {
        subscription = await subscribeNativeChatTranscript(subscribeArgs, setupController.signal)
      } catch (error) {
        if (closed || setupController.signal.aborted) {
          return
        }
        throw error
      }
      // The connection may have closed while the file was being resolved.
      if (closed) {
        subscription.unsubscribe()
        return
      }
      if (!subscription.watching) {
        emit({
          type: 'snapshot',
          messages: [],
          hasMore: false,
          error: 'Transcript unavailable'
        })
      }
      unsubscribe = subscription.unsubscribe
      if (!subscription.watching) {
        return
      }
      recordMobileViewOpened(
        { clientKind, pairedDeviceId },
        {
          surface: 'chat',
          viewKey: `nativeChat:${params.agent}:${params.sessionId}`,
          agent: () => params.agent
        }
      )
    }
  }),
  defineMethod({
    name: 'nativeChat.unsubscribe',
    permission: 'workspace',
    params: NativeChatUnsubscribe,
    handler: async (params, { runtime, connectionId }) => {
      const connection = connectionId ?? 'local'
      if (params.subscriptionId) {
        runtime.cleanupSubscription(`nativeChat:${connection}:${params.subscriptionId}`)
        return { unsubscribed: true }
      }
      runtime.cleanupSubscriptionsByPrefix(`nativeChat:${connection}:`)
      return { unsubscribed: true }
    }
  })
]
