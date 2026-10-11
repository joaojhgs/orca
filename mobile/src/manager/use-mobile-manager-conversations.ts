import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import * as ExpoCrypto from 'expo-crypto'
import {
  createManagerConversation,
  mergeManagerConversationMessages,
  readManagerConversationCatalog,
  readManagerConversationPage,
  sendManagerConversationMessage
} from '../../../src/shared/manager-conversation-client'
import type { ManagerConversationDetail } from '../../../src/shared/manager-conversation-contract'
import type { PendingManagerMutation } from '../../../src/shared/manager-conversation-request'
import type { RpcClient } from '../transport/rpc-client'
import { mobileManagerCall, MobileManagerRefusalError } from './mobile-manager-call'
import type { MobileManagerReceiptStore } from './mobile-manager-receipt-store-contract'
import {
  readMobileManagerWorkspaces,
  type MobileManagerWorkspaceChoice
} from './mobile-manager-workspace-choices'

type Catalog = Awaited<ReturnType<typeof readManagerConversationCatalog>>
const definitiveRefusals = new Set([
  'manager_forbidden',
  'manager_unauthorized',
  'manager_consumer_fenced',
  'invalid_params',
  'forbidden',
  'unauthorized',
  'unknown_method',
  'method_not_found'
])

export function useMobileManagerConversations(
  client: RpcClient,
  receipts: MobileManagerReceiptStore,
  foreground: boolean,
  initialRunId?: string
) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [detail, setDetail] = useState<ManagerConversationDetail | null>(null)
  const [runId, setRunId] = useState<string | null>(initialRunId ?? null)
  const [workspaces, setWorkspaces] = useState<MobileManagerWorkspaceChoice[]>([])
  const [pending, setPending] = useState<PendingManagerMutation | null>(null)
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const active = useRef(true)
  const inFlight = useRef(false)
  const selected = useRef(runId)
  const detailRef = useRef(detail)
  const call = useRef(mobileManagerCall(client, () => active.current)).current

  const operation = useCallback(async (execute: () => Promise<void>) => {
    if (!active.current || inFlight.current) {
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

  const loadDetail = useCallback(
    async (id: string, reset = false) => {
      const previous = reset ? null : detailRef.current
      const after = previous?.run.id === id ? previous.nextSequence : 0
      const page = await readManagerConversationPage(call, id, after)
      if (!active.current || selected.current !== id) {
        return
      }
      const next = {
        ...page,
        messages: mergeManagerConversationMessages(previous?.messages ?? [], page.messages)
      }
      detailRef.current = next
      setDetail(next)
    },
    [call]
  )

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

  useEffect(() => {
    let canceled = false
    active.current = true
    void receipts
      .read()
      .then((receipt) => {
        if (!canceled) {
          setPending(receipt)
          setRecoveryReady(true)
        }
      })
      .catch(() => {
        if (!canceled) {
          setError(
            'Request recovery storage is unavailable. Browsing is still available; sending is blocked.'
          )
        }
      })
    return () => {
      canceled = true
      active.current = false
    }
  }, [receipts])

  useEffect(() => {
    if (!foreground) {
      return
    }
    client.notifyForeground('focus')
    void refresh()
    const refreshSelected = () => {
      const id = selected.current
      if (AppState.currentState === 'active' && id) {
        void operation(() => loadDetail(id))
      }
    }
    const timer = setInterval(refreshSelected, 15_000)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshSelected()
      }
    })
    return () => {
      clearInterval(timer)
      subscription.remove()
    }
  }, [client, foreground, loadDetail, operation, refresh])

  const select = (id: string | null) => {
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
  }

  const mutate = (request: PendingManagerMutation) =>
    operation(async () => {
      if (!recoveryReady) {
        throw new Error('Restore request recovery storage before sending a manager message.')
      }
      const earlier = await receipts.read()
      await receipts.save(request)
      if (!active.current) {
        return
      }
      setPending(request)
      try {
        const { kind: _kind, ...params } = request
        if (request.kind === 'create') {
          const created = await createManagerConversation(call, params)
          if (!active.current) {
            return
          }
          selected.current = created.run.id
          setRunId(created.run.id)
          detailRef.current = { ...created, principalId: request.principalId }
          setDetail(detailRef.current)
        } else {
          await sendManagerConversationMessage(call, params)
          if (!active.current) {
            return
          }
          if (selected.current !== request.runId) {
            selected.current = request.runId
            detailRef.current = null
            setRunId(request.runId)
            setDetail(null)
          }
        }
      } catch (cause) {
        if (
          !earlier &&
          cause instanceof MobileManagerRefusalError &&
          definitiveRefusals.has(cause.code)
        ) {
          await receipts.clear(request.requestId)
          if (active.current) {
            setPending(null)
          }
        }
        throw cause
      }
      await receipts.clear(request.requestId)
      if (!active.current) {
        return
      }
      setPending(null)
      setNotice('Queued for the manager. Work has not been confirmed started.')
      try {
        const next = await readManagerConversationCatalog(call)
        if (!active.current) {
          return
        }
        setCatalog(next)
        if (selected.current) {
          await loadDetail(selected.current)
        }
      } catch {
        if (active.current) {
          setError(
            'The request was accepted, but the view could not refresh. Refresh before relying on activity status.'
          )
        }
      }
    })

  return {
    catalog,
    detail,
    runId,
    workspaces,
    pending,
    recoveryReady,
    busy,
    error,
    notice,
    refresh,
    select,
    moreConversations: () =>
      operation(async () => {
        if (catalog?.nextOffset == null) {
          return
        }
        const next = await readManagerConversationCatalog(call, catalog.nextOffset)
        if (active.current) {
          setCatalog({ ...next, conversations: [...catalog.conversations, ...next.conversations] })
        }
      }),
    loadMore: () =>
      operation(async () => {
        if (selected.current) {
          await loadDetail(selected.current)
        }
      }),
    loadWorkspaces: () =>
      operation(async () => {
        const next = await readMobileManagerWorkspaces(client)
        if (active.current) {
          setWorkspaces(next)
        }
      }),
    retry: () => (pending ? mutate(pending) : Promise.resolve(false)),
    create: (principalId: string, workspaceId: string, objective: string) =>
      mutate({
        kind: 'create',
        requestId: ExpoCrypto.randomUUID(),
        principalId,
        workspaceId,
        objective
      }),
    send: (body: string, replyTo?: string) =>
      selected.current
        ? mutate({
            kind: 'send',
            requestId: ExpoCrypto.randomUUID(),
            runId: selected.current,
            body,
            ...(replyTo ? { replyTo } : {})
          })
        : Promise.resolve(false)
  }
}

export type MobileManagerConversations = ReturnType<typeof useMobileManagerConversations>
