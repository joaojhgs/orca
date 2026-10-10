import { managerMayObserve, type ManagerScopeGrant } from '../../../shared/manager-event-contract'
import { parseExecutionHostId } from '../../../shared/execution-host'
import type { Repo } from '../../../shared/repo-types'
import type { ProjectHostSetup } from '../../../shared/project-types'
import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import type { EnrichedAgentHookEventPayload } from '../../agent-hooks/server/server-types'
import { agentHookGeneration } from '../../agent-hooks/agent-hook-generation'
import { managerHookScope } from './manager-hook-scope'

export function managerStatusSnapshot(input: {
  grant: ManagerScopeGrant
  repos: readonly Repo[]
  setups: readonly ProjectHostSetup[]
  folders?: readonly FolderWorkspace[]
  dispatchForEvent?(
    event: EnrichedAgentHookEventPayload
  ): { id: string; run_id: string | null } | undefined
  statuses: readonly EnrichedAgentHookEventPayload[]
  sshConnected(target: string): boolean
  offset: number
  limit: number
}) {
  const rows = input.statuses.flatMap((event) => {
    const scope = managerHookScope(
      event,
      input.repos,
      input.setups,
      input.dispatchForEvent?.(event),
      input.folders
    )
    if (!scope || !managerMayObserve(input.grant, scope)) {
      return []
    }
    const host = parseExecutionHostId(scope.executionHostId)
    const connected =
      host?.kind === 'local' || (host?.kind === 'ssh' && input.sshConnected(host.targetId))
    const unconfirmed =
      !connected ||
      event.restoredUnconfirmed ||
      event.retainedForLiveness ||
      event.providerSessionOnly
    return [
      {
        scope: {
          ...scope,
          sessionId: event.providerSession?.id ?? event.paneKey,
          sessionGeneration: agentHookGeneration(event)
        },
        agent: event.payload.agentType ?? null,
        state: event.payload.mainAgent?.state ?? event.payload.state,
        statusEvidence: unconfirmed ? ('unconfirmed' as const) : ('current' as const),
        executionContact: connected ? ('connected' as const) : ('unverifiable' as const),
        observedAt: event.receivedAt,
        stateStartedAt: event.payload.mainAgent?.stateStartedAt ?? event.stateStartedAt,
        summary: (
          event.payload.interactivePrompt ??
          event.payload.lastAssistantMessage ??
          event.payload.prompt ??
          ''
        ).slice(0, 4096)
      }
    ]
  })
  const end = input.offset + input.limit
  return {
    sessions: rows.slice(input.offset, end),
    hasMore: end < rows.length,
    nextOffset: end < rows.length ? end : null,
    continuity: 'snapshot-not-replay' as const
  }
}
