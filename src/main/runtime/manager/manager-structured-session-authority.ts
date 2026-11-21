import { createHash } from 'node:crypto'
import type { OrcaRuntimeService } from '../orca-runtime'
import type { AgentSessionConversationView } from '../../../shared/agent-session/lifecycle/leases/agent-session-conversation-view'
import type { AgentJournalMessageItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import {
  formatOrcaSessionAddress,
  isOrcaSessionId
} from '../../../shared/agent-session/identity/orca-session-address'
import { isBotGroupMemberSession } from '../../../shared/bots/bot-group'
import type { ManagerAction } from '../../../shared/manager-principal-contract'
import { managerMayObserve, type ManagerScopeGrant } from '../../../shared/manager-event-contract'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session/lifecycle/operations/agent-session-mutation-envelope'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { formatWorkerTranscriptMessage } from '../../../shared/native-chat/transcript/worker-transcript-text'
import { boundStructuredJournalTail } from '../orchestration/workers/archives/structured-worker-journal-archive'
import { ManagerAuthorityError } from './manager-authority-error'
import { requireManagerPrincipal } from './manager-runtime-authority'
import { managerWorkspaceScope } from './manager-hook-scope'

function conversationScope(
  runtime: OrcaRuntimeService,
  record: AgentSessionConversationView,
  grant: ManagerScopeGrant
) {
  const scope = managerWorkspaceScope(
    record.location.workspaceId,
    record.location.executionHostId,
    runtime.listRepos(),
    runtime.listProjectHostSetups(),
    runtime.listFolderWorkspaces()
  )
  return scope && managerMayObserve(grant, scope) ? scope : null
}

export async function listManagerStructuredSessions(
  runtime: OrcaRuntimeService,
  principalId: string
) {
  const store = await runtime.openAgentSessionRecordStore()
  const grant = runtime
    .getOrchestrationDb()
    .managerPrincipals.authorize(principalId, 'inventory:read').grant.scope
  return store.listConversations().flatMap((record) => {
    const sessionId = record.sessionId
    if (!isOrcaSessionId(sessionId) || isBotGroupMemberSession(sessionId)) {
      return []
    }
    const scope = conversationScope(runtime, record, grant)
    if (!scope) {
      return []
    }
    const contact =
      record.ownerObservation.claimStatus === 'live' && !record.ownerObservation.unreconciled
    return [
      {
        terminal: formatOrcaSessionAddress(sessionId),
        incarnationId: String(record.currentFence),
        scope,
        title: record.conversationName ?? record.provider,
        agent: record.provider,
        executionContact: contact ? ('connected' as const) : ('unverifiable' as const),
        writable: record.ownerObservation.claimStatus !== 'conflicted',
        lastOutputAt: record.updatedAt,
        ownership: 'unchanged' as const
      }
    ]
  })
}

type StructuredManagerSession = { serviceToken: string; incarnationId: string; sessionId: string }

function requireConversation(
  runtime: OrcaRuntimeService,
  store: Awaited<ReturnType<OrcaRuntimeService['openAgentSessionRecordStore']>>,
  params: StructuredManagerSession,
  action: ManagerAction
) {
  const db = runtime.getOrchestrationDb()
  const principal = requireManagerPrincipal(db, params.serviceToken)
  const grant = db.managerPrincipals.authorize(principal.id, action).grant.scope
  const record = store.getConversation(params.sessionId)
  if (
    !record ||
    String(record.currentFence) !== params.incarnationId ||
    isBotGroupMemberSession(params.sessionId) ||
    !conversationScope(runtime, record, grant)
  ) {
    throw new ManagerAuthorityError(
      'manager_forbidden',
      'Session identity, generation or scope changed; re-list sessions'
    )
  }
  return { principal, record }
}

async function openHost(runtime: OrcaRuntimeService) {
  await runtime.ensureStructuredAgentSessionHost()
  const host = getStructuredAgentSessionHost()
  if (!host) {
    throw new Error('Structured session host is unavailable')
  }
  return host
}

export async function readManagerStructuredSession(
  runtime: OrcaRuntimeService,
  params: StructuredManagerSession & { terminal: string; limit: number; cursor?: number }
) {
  if (params.cursor !== undefined) {
    throw new Error('Structured session history has no terminal line cursor')
  }
  const store = await runtime.openAgentSessionRecordStore()
  requireConversation(runtime, store, params, 'session:read')
  const host = await openHost(runtime)
  requireConversation(runtime, store, params, 'session:read')
  const { page } = await host.history({
    sessionId: params.sessionId,
    direction: 'tail',
    limit: params.limit
  })
  requireConversation(runtime, store, params, 'session:read')
  const bounded = boundStructuredJournalTail(page.items)
  return {
    terminal: {
      handle: params.terminal,
      lines: bounded.messages.flatMap((message) =>
        formatWorkerTranscriptMessage(message).split('\n')
      ),
      truncated: page.hasOlder || bounded.limited,
      nextCursor: null
    },
    incarnationId: params.incarnationId
  }
}

export async function guideManagerStructuredSession(
  runtime: OrcaRuntimeService,
  params: StructuredManagerSession & {
    terminal: string
    requestId: string
    body: string
    lease: Parameters<
      ReturnType<OrcaRuntimeService['getOrchestrationDb']>['managerPrincipals']['withLease']
    >[0]
  }
) {
  const store = await runtime.openAgentSessionRecordStore()
  const db = runtime.getOrchestrationDb()
  const principal = requireManagerPrincipal(db, params.serviceToken, params.lease)
  const assertAuthority = () =>
    db.managerPrincipals.withLease(params.lease, 'session:guide', () =>
      requireConversation(runtime, store, params, 'session:guide')
    )
  assertAuthority()
  const host = await openHost(runtime)
  const { record } = assertAuthority()
  const body: AgentJournalMessageItem = {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: params.body }]
  }
  const clientOperationId = createHash('sha256')
    .update(
      JSON.stringify(['manager-session-guide', principal.id, params.sessionId, params.requestId])
    )
    .digest('hex')
  const send = await host.send(
    { callerKey: `manager-service:${principal.id}` },
    {
      body,
      envelope: {
        sessionId: params.sessionId,
        clientOperationId,
        expectedRuntimeFence: record.currentFence,
        payloadFingerprint: computeAgentSessionPayloadFingerprint({
          method: 'agentSession.send',
          sessionId: params.sessionId,
          fields: { body }
        })
      },
      beforeRun: () => {
        assertAuthority()
      }
    }
  )
  return {
    terminal: params.terminal,
    incarnationId: params.incarnationId,
    requestId: params.requestId,
    send,
    ownership: 'unchanged' as const
  }
}
