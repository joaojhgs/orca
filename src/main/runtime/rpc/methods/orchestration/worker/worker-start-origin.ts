import type { OrchestrationDb } from '../../../../orchestration/db'
import type { ManagerEventScope } from '../../../../../../shared/manager-event-contract'

/** Internal-only origin; service RPCs never accept terminal identity claims. */
export type WorkerStartServiceOrigin = {
  workspaceId: string
  scope: ManagerEventScope
  assertAuthority: () => void
  assertPlacement: (dispatchId: string) => void
  acceptDispatch: (
    operation: () => ReturnType<OrchestrationDb['createStartingWorkerDispatch']>
  ) => ReturnType<OrchestrationDb['createStartingWorkerDispatch']>
}
