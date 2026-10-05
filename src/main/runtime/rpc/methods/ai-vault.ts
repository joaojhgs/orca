import { AiVaultSetSearchEnabledParamsSchema } from '../../../../shared/ai-vault-search-contract'
import {
  searchSessionService,
  sessionSearchServiceStatus
} from '../../../ai-vault-search/session-search-service-registry'
import { defineMethod } from '../core'
import { restampAiVaultListResult } from '../../../ai-vault/session-list-results'
import type { AiVaultPrepareSessionResumeArgs } from '../../../../shared/ai-vault-resume-preparation'
import { LOCAL_EXECUTION_HOST_ID, parseExecutionHostId } from '../../../../shared/execution-host'
import type { AiVaultListResult } from '../../../../shared/ai-vault-types'
import { resolveAiVaultSessionTitlesByHost } from '../../../ipc/ai-vault-session-title-routing'
import {
  searchAiVaultSessionsByHost,
  aiVaultSearchStatusByHost
} from '../../../ipc/ai-vault-search'
import { redactForTransport } from '../../../../shared/ai-vault-search-transport'

import { describeAiVaultScanError } from '../../../../shared/ai-vault-scan-error-message'
import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import {
  assertLegacyAiVaultResumeAllowed,
  projectStructuredAiVaultSessions
} from '../../../ai-vault/structured-session-ownership'
import { ensureStructuredAgentSessionHostUnlessRefused } from '../../structured-agent-session-host-refusal'
import {
  AiVaultListSessionsParams,
  AiVaultPrepareSessionResumeParams,
  AiVaultSessionTitlesParams,
  AiVaultSearchSessionsParams,
  AiVaultSearchStatusParams
} from '../../../../shared/rpc-contract/ai-vault-params'
export { AiVaultListSessionsParams, AiVaultPrepareSessionResumeParams, AiVaultSessionTitlesParams }

export const AI_VAULT_METHODS = [
  defineMethod({
    name: 'aiVault.searchSessions',
    params: AiVaultSearchSessionsParams,
    handler: async (params, { clientKind }) => {
      if (!params.executionHostScope || params.executionHostScope === 'local') {
        return searchSessionService(params, clientKind ? 'relay' : 'runtime')
      }
      const result = await searchAiVaultSessionsByHost(params, params.executionHostScope)
      return result.kind === 'results' && clientKind
        ? { ...result, hits: result.hits.map((hit) => redactForTransport(hit, 'relay')) }
        : result
    }
  }),
  defineMethod({
    name: 'aiVault.searchStatus',
    params: AiVaultSearchStatusParams,
    handler: (params, { clientKind }) =>
      params.executionHostScope?.startsWith('ssh:')
        ? aiVaultSearchStatusByHost(params.executionHostScope)
        : sessionSearchServiceStatus(params, clientKind ? 'relay' : 'runtime')
  }),
  defineMethod({
    name: 'aiVault.setSearchEnabled',
    params: AiVaultSetSearchEnabledParamsSchema,
    handler: async (params, { runtime, clientKind, pairedDeviceId }) => {
      // Paired clients only: an in-process caller writes this host's own settings directly,
      // and admitting one here would let any unauthenticated local path flip consent.
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
      return sessionSearchServiceStatus({}, clientKind ? 'relay' : 'runtime')
    }
  }),
  defineMethod({
    name: 'aiVault.resolveSessionTitles',
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
    params: AiVaultListSessionsParams,
    handler: async (params, { runtime, clientKind, clientCapabilities }) => {
      await ensureStructuredAgentSessionHostUnlessRefused(() =>
        runtime.ensureStructuredAgentSessionHost()
      )
      let result
      try {
        result = await runtime.listAiVaultSessions({
          limit: params.unlimited ? undefined : params.limit,
          unlimited: params.unlimited,
          force: params.force,
          scopePaths: params.scopePaths,
          ...(params.executionHostScope ? { executionHostScope: params.executionHostScope } : {}),
          includeAntigravityIdeSessions: params.includeAntigravityIdeSessions
        })
      } catch (error) {
        if (error instanceof Error) {
          error.message = describeAiVaultScanError(error.message)
          throw error
        }
        throw new Error(describeAiVaultScanError(String(error)))
      }
      // Why: web clients consume this response directly (no parent-side retag),
      // so sessions must come back stamped as the runtime host they addressed.
      const stamped = params.executionHostId
        ? stampRuntimeOwnedSessions(result, params.executionHostId)
        : result
      return projectStructuredAiVaultSessions(
        stamped,
        clientKind === undefined ||
          (clientCapabilities?.includes(STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY) ?? false)
      )
    }
  }),
  defineMethod({
    name: 'aiVault.prepareSessionResume',
    params: AiVaultPrepareSessionResumeParams,
    handler: async (params, { runtime }) => {
      const requestedHost = parseExecutionHostId(params.executionHostId)
      if (requestedHost?.kind === 'ssh') {
        // SSH transcripts are already on their owning host; never materialize them locally.
        return { useRealCodexHome: false }
      }
      const args: AiVaultPrepareSessionResumeArgs = {
        agent: params.agent,
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        filePath: params.filePath,
        codexHome: params.codexHome,
        // Why: the RPC executes on the transcript-owning host; never let a
        // client-provided runtime/SSH stamp escape that host boundary.
        executionHostId: LOCAL_EXECUTION_HOST_ID
      }
      await ensureStructuredAgentSessionHostUnlessRefused(() =>
        runtime.ensureStructuredAgentSessionHost()
      )
      assertLegacyAiVaultResumeAllowed(args)
      return runtime.prepareAiVaultSessionResume(args)
    }
  })
]

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
