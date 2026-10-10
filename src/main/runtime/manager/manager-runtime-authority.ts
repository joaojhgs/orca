import type { OrchestrationDb } from '../orchestration/db'
import type { ManagerConsumerLease } from '../../../shared/manager-principal-contract'
import { ManagerAuthorityError } from './manager-authority-error'

export function requireManagerPrincipal(
  db: OrchestrationDb,
  token: string,
  lease?: ManagerConsumerLease
) {
  const principal = db.managerPrincipals.authenticate(token)
  if (!principal || (lease && lease.principalId !== principal.id)) {
    throw new ManagerAuthorityError('manager_unauthorized', 'Manager credential is not active')
  }
  return principal
}
