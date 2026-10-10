import type { EnrichedAgentHookEventPayload } from '../agent-hooks/server/server-types'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { RuntimeStore } from '../runtime/runtime-store-contract'
import { managerHookEvent } from '../runtime/manager/manager-hook-event'
import { managerHookScope } from '../runtime/manager/manager-hook-scope'
import { resolveNotificationScopePolicy } from '../../shared/notification-scope-policy'
import type { NotificationSettings } from '../../shared/notification-settings-types'

export function recordManagerHookEvent(
  runtime: Pick<OrcaRuntimeService, 'getExistingOrchestrationDb' | 'getTerminalHandleForPaneKey'>,
  store: Pick<RuntimeStore, 'getRepos' | 'getProjectHostSetups' | 'getFolderWorkspaces'> & {
    getSettings(): { notifications: NotificationSettings }
  },
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
    const kind =
      input.kind === 'turn-complete'
        ? 'completion'
        : input.kind === 'permission-wait'
          ? 'permission'
          : input.kind === 'dispatch-settled'
            ? 'completion'
            : input.kind
    if (
      !resolveNotificationScopePolicy(
        store.getSettings().notifications.scopePolicy,
        input.scope,
        kind,
        'mobile'
      ).manager
    ) {
      return
    }
    db.managerEvents.append(input)
  }
}
