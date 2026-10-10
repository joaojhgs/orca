import { useCallback, useEffect, useRef, useState } from 'react'
import {
  callRuntimeRpc,
  RuntimeRpcCallError,
  type RuntimeClientTarget
} from '@/runtime/runtime-rpc-client'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  createManagerConversation,
  mergeManagerConversationMessages,
  readManagerConversationCatalog,
  readManagerConversationPage,
  sendManagerConversationMessage
} from '../../../../shared/manager-conversation-client'
import type { ManagerConversationDetail } from '../../../../shared/manager-conversation-contract'

import {
  clearPendingManagerMutation,
  readPendingManagerMutation,
  savePendingManagerMutation,
  type PendingManagerMutation
} from './manager-conversation-request-receipts'
type Catalog = Awaited<ReturnType<typeof readManagerConversationCatalog>>

export function useManagerConversations(target: RuntimeClientTarget, ownerKey: string) {
  const [initialReceipt] = useState(() => {
    try {
      return { pending: readPendingManagerMutation(ownerKey), error: null }
    } catch {
      return {
        pending: null,
        error:
          'Request recovery storage is unavailable. Restore this tab’s storage before sending objectives or replies.'
      }
    }
  })
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [detail, setDetail] = useState<ManagerConversationDetail | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(initialReceipt.error)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(initialReceipt.pending)
  const active = useRef(true)
  const inFlight = useRef(false)
  const selected = useRef(runId)
  selected.current = runId
  const detailRef = useRef(detail)
  detailRef.current = detail
  const call = useCallback(
    (method: string, params: unknown) =>
      callRuntimeRpc<unknown>(target, method, params, { timeoutMs: 30_000 }),
    [target]
  )

  const loadDetail = useCallback(
    async (id: string, reset = false) => {
      const previous = reset ? null : detailRef.current
      const after = previous?.run.id === id ? previous.nextSequence : 0
      const page = await readManagerConversationPage(call, id, after)
      if (!active.current || selected.current !== id) {
        return
      }
      const messages = mergeManagerConversationMessages(previous?.messages ?? [], page.messages)
      const next = { ...page, messages }
      detailRef.current = next
      setDetail(next)
    },
    [call]
  )

  const operation = useCallback(async (execute: () => Promise<void>) => {
    if (inFlight.current || !active.current) {
      return false
    }
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      await execute()
      return active.current
    } catch (cause) {
      if (active.current) {
        setError(cause instanceof Error ? cause.message : 'Manager request failed.')
      }
      return false
    } finally {
      inFlight.current = false
      if (active.current) {
        setBusy(false)
      }
    }
  }, [])

  const refresh = useCallback(
    () =>
      operation(async () => {
        const next = await readManagerConversationCatalog(call)
        if (!active.current) {
          return
        }
        setCatalog(next)
        if (selected.current) {
          await loadDetail(selected.current)
        }
      }),
    [call, loadDetail, operation]
  )

  const select = useCallback(
    (id: string | null) => {
      if (inFlight.current) {
        return
      }
      selected.current = id
      detailRef.current = null
      setRunId(id)
      setDetail(null)
      setNotice(null)
      if (id) {
        void operation(() => loadDetail(id, true))
      }
    },
    [loadDetail, operation]
  )

  const mutate = useCallback(
    (request: PendingManagerMutation) =>
      operation(async () => {
        const earlier = readPendingManagerMutation(ownerKey)
        if (earlier && earlier.requestId !== request.requestId) {
          throw new Error(
            'Reconcile the unconfirmed request before sending another objective or reply.'
          )
        }
        savePendingManagerMutation(ownerKey, request)
        setPending(request)
        try {
          if (request.kind === 'create') {
            const { kind: _kind, ...params } = request
            const created = await createManagerConversation(call, params)
            if (!active.current) {
              return
            }
            selected.current = created.run.id
            setRunId(created.run.id)
            const next = { ...created, principalId: request.principalId }
            detailRef.current = next
            setDetail(next)
          } else {
            const { kind: _kind, ...params } = request
            await sendManagerConversationMessage(call, params)
            if (!active.current) {
              return
            }
            if (selected.current !== request.runId) {
              selected.current = request.runId
              detailRef.current = null
              setDetail(null)
              setRunId(request.runId)
            }
          }
        } catch (cause) {
          if (
            !earlier &&
            cause instanceof RuntimeRpcCallError &&
            [
              'manager_forbidden',
              'manager_unauthorized',
              'manager_consumer_fenced',
              'invalid_params',
              'forbidden',
              'unauthorized',
              'unknown_method'
            ].includes(cause.code)
          ) {
            clearPendingManagerMutation(ownerKey)
            if (active.current) {
              setPending(null)
            }
          }
          throw cause
        }
        clearPendingManagerMutation(ownerKey)
        setPending(null)
        setNotice('Queued for the manager. This is not confirmation that work has started.')
        // A committed reply must not become retryable just because the following read fails.
        try {
          const nextCatalog = await readManagerConversationCatalog(call)
          if (active.current) {
            setCatalog(nextCatalog)
          }
          if (selected.current) {
            await loadDetail(selected.current)
          }
        } catch (cause) {
          if (active.current) {
            setError(cause instanceof Error ? cause.message : 'Refresh the conversation.')
          }
        }
      }),
    [call, loadDetail, operation, ownerKey]
  )

  useEffect(() => {
    active.current = true
    void refresh()
    const refreshSelected = () => {
      const id = selected.current
      if (id && document.visibilityState === 'visible') {
        void operation(() => loadDetail(id))
      }
    }
    const timer = window.setInterval(refreshSelected, 15_000)
    document.addEventListener('visibilitychange', refreshSelected)
    return () => {
      active.current = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshSelected)
    }
  }, [refresh, loadDetail, operation])

  const moreConversations = () =>
    operation(async () => {
      if (catalog?.nextOffset == null) {
        return
      }
      const next = await readManagerConversationCatalog(call, catalog.nextOffset)
      if (active.current) {
        setCatalog({ ...next, conversations: [...catalog.conversations, ...next.conversations] })
      }
    })
  return {
    catalog,
    detail,
    runId,
    busy,
    error: error ?? initialReceipt.error,
    notice,
    pending,
    recoveryBlocked: Boolean(initialReceipt.error),
    refresh,
    select,
    moreConversations,
    loadMore: () =>
      operation(async () => {
        if (selected.current) {
          await loadDetail(selected.current)
        }
      }),
    retry: () => pending && mutate(pending),
    create: (principalId: string, workspaceId: string, objective: string) =>
      mutate({
        kind: 'create',
        requestId: createBrowserUuid(),
        principalId,
        workspaceId,
        objective
      }),
    send: (body: string, replyTo?: string) =>
      selected.current
        ? mutate({
            kind: 'send',
            requestId: createBrowserUuid(),
            runId: selected.current,
            body,
            ...(replyTo ? { replyTo } : {})
          })
        : Promise.resolve(false)
  }
}
