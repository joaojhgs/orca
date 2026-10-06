import type { PtyListedSession, PtySessionListScope } from '../../../../shared/pty-listed-session'
import {
  PtyProcessListAdmission,
  visitPtyProcessListingsInBatches
} from '../../../providers/pty-process-list-admission'
import { ptyOwnership } from '../provider/ownership-state'
import { getProvider, registeredPtyProviders } from '../provider/registry'
import { toSshExecutionHostId } from '../../../../shared/execution-host'

/** Host-authoritative inventory shared by IPC and paired-browser diagnostics. */
export async function listPtySessions(
  scope?: PtySessionListScope,
  getLocalPtyProviderStartupPromise: () => Promise<void> | undefined = () => undefined
): Promise<PtyListedSession[]> {
  if (scope !== undefined) {
    if (
      !scope ||
      (scope.connectionId !== null &&
        (typeof scope.connectionId !== 'string' || !scope.connectionId.trim()))
    ) {
      throw new Error('invalid_pty_session_list_scope')
    }
    // Select the daemon only after startup has handed off ownership.
    if (scope.connectionId === null) {
      await getLocalPtyProviderStartupPromise()
    }
  }
  const deduped = new Map<string, PtyListedSession>()
  const admission = new PtyProcessListAdmission()
  await visitPtyProcessListingsInBatches(
    scope === undefined
      ? registeredPtyProviders()
      : [{ provider: getProvider(scope.connectionId), connectionId: scope.connectionId }],
    ({ provider, connectionId }) =>
      connectionId === null || scope !== undefined
        ? provider.listProcesses()
        : provider.listProcesses().catch(() => []),
    ({ provider, connectionId }, sessions) => {
      for (const rawSession of sessions) {
        const session = admission.admit(rawSession)
        // Why: kill actions only send back the PTY id, so rebuild ownership while listing to keep reconnect-discovered remote sessions routed to their provider.
        ptyOwnership.set(session.id, connectionId)
        deduped.set(session.id, {
          id: session.id,
          cwd: session.cwd,
          title: session.title,
          executionHostId: connectionId === null ? 'local' : toSshExecutionHostId(connectionId),
          ...(session.worktreeId !== undefined ? { worktreeId: session.worktreeId } : {}),
          // Why: the renderer's binding map is empty during restore, so ownership is the only
          // liveness evidence it has. Absence is authoritative only from a provider that
          // serializes claims — otherwise it is 'unknown', never 'absent' (#8459).
          agentOwnership:
            (session.agentSessionOwners?.length ?? 0) > 0
              ? 'present'
              : provider.providesAgentSessionOwnerListings?.(session.id) === true
                ? 'absent'
                : 'unknown'
        })
      }
    }
  )
  return Array.from(deduped.values())
}
