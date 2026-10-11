import type { EnrichedAgentHookEventPayload } from '../../agent-hooks/server/server-types'
import { getConnectionExecutionHostId } from '../../../shared/execution-host'
import { normalizeWorkspaceSessionKeyToWorkspaceId } from '../../../shared/workspace-scope'
import { ManagerAuthorityError } from './manager-authority-error'

/** A known user session's editing custody is not free merely because it lacks a supervised Dispatch. */
export function assertManagerAgentWorkspaceCapacity(
  statuses: readonly EnrichedAgentHookEventPayload[],
  hostId: string,
  workspaceId: string,
  contact: 'connected' | 'unverifiable' = 'unverifiable'
): void {
  const occupied = statuses.some(
    (event) =>
      !event.providerSessionOnly &&
      event.worktreeId &&
      getConnectionExecutionHostId(event.connectionId) === hostId &&
      normalizeWorkspaceSessionKeyToWorkspaceId(event.worktreeId) === workspaceId &&
      (contact === 'unverifiable' ||
        event.restoredUnconfirmed ||
        event.retainedForLiveness ||
        event.isReplay ||
        event.payload.state !== 'done')
  )
  if (occupied) {
    throw new ManagerAuthorityError(
      'manager_forbidden',
      'Workspace has a current or unverifiable agent session; inspect it before dispatching another writer'
    )
  }
}
