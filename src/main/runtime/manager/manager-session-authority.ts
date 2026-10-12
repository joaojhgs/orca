import type { OrcaRuntimeService } from '../orca-runtime'
import type { ManagerAction } from '../../../shared/manager-principal-contract'
import { managerMayObserve } from '../../../shared/manager-event-contract'
import { managerWorkspaceScope } from './manager-hook-scope'
import { ManagerAuthorityError } from './manager-authority-error'
import { requireManagerPrincipal } from './manager-runtime-authority'

/** Existing sessions retain their owner. Only current project/host and incarnation confer access. */
export function requireManagerSession(
  runtime: OrcaRuntimeService,
  params: { serviceToken: string; terminal: string; incarnationId: string },
  action: ManagerAction
) {
  const db = runtime.getOrchestrationDb()
  const principal = requireManagerPrincipal(db, params.serviceToken)
  const grant = db.managerPrincipals.authorize(principal.id, action).grant.scope
  const pane = runtime.getPaneKeyForTerminalHandle(params.terminal)
  if (!pane) {
    throw new ManagerAuthorityError('manager_forbidden', 'Session identity is unverifiable')
  }
  const terminal = runtime.resolveTerminalPane(pane)
  if (
    terminal.handle !== params.terminal ||
    !terminal.worktreeId ||
    !terminal.executionHostId ||
    terminal.incarnationId !== params.incarnationId ||
    !terminal.connected ||
    !terminal.ptyId
  ) {
    throw new ManagerAuthorityError(
      'manager_forbidden',
      'Session incarnation/contact changed; re-list sessions'
    )
  }
  const scope = managerWorkspaceScope(
    terminal.worktreeId,
    terminal.executionHostId,
    runtime.listRepos(),
    runtime.listProjectHostSetups(),
    runtime.listFolderWorkspaces()
  )
  if (!scope || !managerMayObserve(grant, scope)) {
    throw new ManagerAuthorityError(
      'manager_forbidden',
      'Session is outside the granted project and host'
    )
  }
  return { principal, terminal, scope }
}
