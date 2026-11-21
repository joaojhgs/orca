import type { AiVaultListResult } from '../../../../../shared/ai-vault/contracts/ai-vault-types'
import { prepareStructuredChatCliFork } from '../../../../ai-vault/structured-sessions/structured-chat-cli-fork'
import { writeAiVaultSessionHandoffSnapshot } from '../../../../ai-vault/session-handoff-snapshot'
import { AiVaultSetSearchEnabledParamsSchema } from '../../../../../shared/ai-vault/search/ai-vault-search-contract'
import {
  redactForTransport,
  sessionSearchTransportForClient
} from '../../../../../shared/ai-vault/search/ai-vault-search-transport'
import {
  searchSessionService,
  sessionSearchServiceStatus
} from '../../../../ai-vault-search/session-search-service-registry'
import { defineMethod } from '../../core'
import { resolveAiVaultSessionTitlesByHost } from '../../../../ipc/ai-vault/ai-vault-session-title-routing'
import {
  searchAiVaultSessionsByHost,
  aiVaultSearchStatusByHost
} from '../../../../ipc/ai-vault/ai-vault-host-search'
import { conditionalAiVaultListResult } from '../../../../ai-vault/listing/session-list-fingerprint'
import { restampAiVaultListResult } from '../../../../ai-vault/listing/session-list-results'
import { copyStructuredChatConversation } from '../../../../ai-vault/structured-sessions/structured-chat-conversation-copy'
import type { AiVaultPrepareSessionResumeArgs } from '../../../../../shared/ai-vault/resume/ai-vault-resume-preparation'
import {
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId
} from '../../../../../shared/execution-host/execution-host'
import { isWslUncPath } from '../../../../../shared/file-access/wsl-paths'
import { describeAiVaultScanError } from '../../../../../shared/ai-vault/scanning/ai-vault-scan-error-message'
import {
  assertLegacyAiVaultResumeAllowed,
  projectStructuredAiVaultSessions,
  searchWithStructuredOwners
} from '../../../../ai-vault/structured-sessions/structured-session-ownership'
import {
  ensureStructuredAgentSessionHostUnlessRefused,
  tryEnsureStructuredAgentSessionHostForResume
} from '../../../agent-session/installation/structured-agent-session-host-refusal'
import {
  clientOpensStructuredChatFromHistory,
  supportsStructuredAgentSessions
} from '../structured-sessions/structured-agent-session-policy'
import {
  AiVaultSearchSessionsParams,
  AiVaultSearchStatusParams,
  AiVaultDeleteSessionParams,
  AiVaultListSessionsParams,
  AiVaultPrepareSessionHandoffParams,
  AiVaultPrepareSessionResumeParams,
  AiVaultSessionTitlesParams
} from '../../../../../shared/rpc-contract/ai-vault/ai-vault-params'

export const AI_VAULT_METHODS = [
  defineMethod({
    name: 'aiVault.searchSessions',
    requires: ['sessionSearch'],
    permission: 'workspace',
    params: AiVaultSearchSessionsParams,
    handler: async (params, context) => {
      const transport = sessionSearchTransportForClient(context.clientKind)
      if (params.executionHostScope && params.executionHostScope !== 'local') {
        const result = await searchAiVaultSessionsByHost(params, params.executionHostScope)
        return result.kind === 'results'
          ? { ...result, hits: result.hits.map((hit) => redactForTransport(hit, transport)) }
          : result
      }
      const response = searchSessionService(params, transport)
      // A client that reads no structured sessions keeps the transcript hit, as before.
      return supportsStructuredAgentSessions(context)
        ? searchWithStructuredOwners(response, {
            ensureHost: () => context.runtime.ensureStructuredAgentSessionHost(),
            transport,
            opensChat: (agent) => clientOpensStructuredChatFromHistory(context, agent)
          })
        : response
    }
  }),
  defineMethod({
    name: 'aiVault.searchStatus',
    requires: ['sessionSearch'],
    permission: 'workspace',
    params: AiVaultSearchStatusParams,
    handler: (params, { clientKind }) =>
      params.executionHostScope?.startsWith('ssh:')
        ? aiVaultSearchStatusByHost(params.executionHostScope)
        : sessionSearchServiceStatus(params, sessionSearchTransportForClient(clientKind))
  }),
  defineMethod({
    name: 'aiVault.setSearchEnabled',
    requires: ['sessionSearch'],
    permission: 'settings-write',
    params: AiVaultSetSearchEnabledParamsSchema,
    handler: async (params, { runtime, clientKind, pairedDeviceId }) => {
      // Only authenticated paired clients may flip host consent; local callers write settings directly.
      if (!pairedDeviceId) {
        throw Object.assign(
          new Error('Session search consent can only be changed by a paired client.'),
          { code: 'forbidden' }
        )
      }
      await runtime.setSessionSearchEnabled(params.enabled)
      console.warn(
        `[ai-vault-search] device ${pairedDeviceId} set indexing enabled=${params.enabled}`
      )
      return sessionSearchServiceStatus({}, sessionSearchTransportForClient(clientKind))
    }
  }),
  defineMethod({
    name: 'aiVault.resolveSessionTitles',
    permission: 'workspace',
    params: AiVaultSessionTitlesParams,
    handler: (params, { runtime, signal }) =>
      params.executionHostScope?.startsWith('ssh:')
        ? resolveAiVaultSessionTitlesByHost({
            executionHostScope: parseExecutionHostId(params.executionHostScope)?.id,
            requests: params.requests
          })
        : runtime.resolveAiVaultSessionTitles(params.requests, signal)
  }),
  defineMethod({
    name: 'aiVault.listSessions',
    permission: 'workspace',
    params: AiVaultListSessionsParams,
    handler: async (params, { runtime, clientKind, clientCapabilities, signal }) => {
      await ensureStructuredAgentSessionHostUnlessRefused(() =>
        runtime.ensureStructuredAgentSessionHost()
      )
      let result
      try {
        result = await runtime.listAiVaultSessions(
          {
            limit: params.unlimited ? undefined : params.limit,
            unlimited: params.unlimited,
            force: params.force,
            scopePaths: params.scopePaths,
            scopeOnly: params.scopeOnly,
            ...(params.executionHostScope ? { executionHostScope: params.executionHostScope } : {}),
            includeAntigravityIdeSessions: params.includeAntigravityIdeSessions
          },
          signal
        )
      } catch (error) {
        if (error instanceof Error) {
          error.message = describeAiVaultScanError(error.message)
          throw error
        }
        throw new Error(describeAiVaultScanError(String(error)))
      }
      // Web clients have no parent retagging, so stamp sessions with the runtime host they addressed.
      const projected = projectStructuredAiVaultSessions(result, (agent) =>
        clientOpensStructuredChatFromHistory({ clientKind, clientCapabilities }, agent)
      )
      return conditionalAiVaultListResult(
        params.executionHostId
          ? stampRuntimeOwnedSessions(projected, params.executionHostId)
          : projected,
        params.unlimited ? undefined : params.afterFingerprint,
        params.force
      )
    }
  }),
  defineMethod({
    name: 'aiVault.prepareSessionResume',
    permission: 'workspace',
    params: AiVaultPrepareSessionResumeParams,
    handler: async (params, { runtime }) => {
      if (parseExecutionHostId(params.executionHostId)?.kind === 'ssh') {
        return { useRealCodexHome: false }
      }
      if ('sourceChat' in params) {
        await runtime.ensureStructuredAgentSessionHost()
        return prepareStructuredChatCliFork(params, (args) =>
          runtime.prepareAiVaultSessionResume(args)
        )
      }
      const args: AiVaultPrepareSessionResumeArgs = {
        agent: params.agent,
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        ...(params.fork ? { fork: true } : {}),
        filePath: params.filePath,
        codexHome: params.codexHome,
        // This host owns the transcripts; never echo a client-supplied runtime/SSH owner stamp.
        executionHostId: LOCAL_EXECUTION_HOST_ID
      }
      if (!isWslUncPath(args.filePath)) {
        const ensureHost = () => runtime.ensureStructuredAgentSessionHost()
        await (args.codexHome === null && !args.fork
          ? tryEnsureStructuredAgentSessionHostForResume(ensureHost)
          : ensureStructuredAgentSessionHostUnlessRefused(ensureHost))
        assertLegacyAiVaultResumeAllowed(args)
      }
      return (
        (await copyStructuredChatConversation(args)) ?? runtime.prepareAiVaultSessionResume(args)
      )
    }
  }),
  defineMethod({
    name: 'aiVault.prepareSessionHandoff',
    permission: 'workspace',
    params: AiVaultPrepareSessionHandoffParams,
    handler: (params) => writeAiVaultSessionHandoffSnapshot(params)
  }),
  defineMethod({
    name: 'aiVault.deleteSession',
    permission: 'workspace',
    params: AiVaultDeleteSessionParams,
    handler: (params, { runtime }) => runtime.deleteAiVaultSession(params)
  })
]

export { AiVaultListSessionsParams, AiVaultPrepareSessionResumeParams }

function stampRuntimeOwnedSessions(
  result: AiVaultListResult,
  executionHostId: `runtime:${string}`
) {
  const stamped = restampAiVaultListResult(result, executionHostId)
  return {
    ...result,
    sessions: result.sessions.map((session, index) =>
      session.executionHostId === 'local' ? stamped.sessions[index] : session
    ),
    issues: result.issues.map((issue, index) =>
      !issue.executionHostId || issue.executionHostId === 'local' ? stamped.issues[index] : issue
    )
  }
}
