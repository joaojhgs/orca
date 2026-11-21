import type { EnrichedAgentHookEventPayload } from '../../agent-hooks/server/server-types'
import type { OrcaRuntimeService } from '../orca-runtime'
import type { RuntimeStore } from '../construction/runtime-store-contract'
import { managerHookEvent } from './manager-hook-event'
import { managerHookScope } from './manager-hook-scope'

export function recordManagerHookEvent(
  runtime: Pick<OrcaRuntimeService, 'getExistingOrchestrationDb' | 'getTerminalHandleForPaneKey'>,
  store: Pick<RuntimeStore, 'getRepos' | 'getProjectHostSetups' | 'getFolderWorkspaces'>,
  event: EnrichedAgentHookEventPayload
): void {
  const db = runtime.getExistingOrchestrationDb()
  if (!db?.managerPrincipals.hasActivePrincipal() || !event.worktreeId) {
    return
  }
  const handle = runtime.getTerminalHandleForPaneKey(event.paneKey)
  const dispatch = handle ? db.getActiveDispatchForTerminal(handle, event.paneKey) : undefined
  const scope = managerHookScope(
    event,
    store.getRepos(),
    store.getProjectHostSetups?.() ?? [],
    dispatch,
    store.getFolderWorkspaces?.() ?? []
  )
  if (!scope) {
    return
  }
  const input = managerHookEvent(event, scope)
  if (input) {
    db.managerEvents.append(input)
  }
}
