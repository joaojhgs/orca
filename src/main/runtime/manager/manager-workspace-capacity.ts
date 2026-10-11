import { z } from 'zod'
import type { OrchestrationDb } from '../orchestration/db'
import { ManagerEventScopeSchema } from '../../../shared/manager-event-contract'
import { parseWorkerTerminalHostScope } from '../../../shared/worker-terminal-host-scope'
import { toSshExecutionHostId } from '../../../shared/execution-host'
import { ManagerAuthorityError } from './manager-authority-error'

const activeWorker = z.object({
  worktree_id: z.string().nullable(),
  host_scope: z.string().nullable(),
  start_options: z.string()
})
const startOptions = z.object({
  managerScope: z.unknown().optional(),
  resolvedWorktreeId: z.string().nullable().optional(),
  workspaceId: z.string().optional()
})

function executionHostId(value: string | null): string | null {
  const scope = parseWorkerTerminalHostScope(value)
  return scope?.kind === 'ssh'
    ? toSshExecutionHostId(scope.targetId)
    : scope?.kind === 'local' || scope?.kind === 'wsl'
      ? 'local'
      : null
}

function availableFor(
  row: z.infer<typeof activeWorker>,
  hostId: string,
  workspaceId: string
): boolean {
  let options
  try {
    options = startOptions.parse(JSON.parse(row.start_options))
  } catch {
    return executionHostId(row.host_scope) !== null && executionHostId(row.host_scope) !== hostId
  }
  const declared = ManagerEventScopeSchema.safeParse(options.managerScope)
  const declaredHost = declared.success ? declared.data.executionHostId : null
  const actualHost = executionHostId(row.host_scope)
  if (actualHost && declaredHost && actualHost !== declaredHost) {
    return actualHost !== hostId && declaredHost !== hostId
  }
  const workerHost = actualHost ?? declaredHost
  if (workerHost && workerHost !== hostId) {
    return true
  }
  const assigned =
    row.worktree_id ??
    options.resolvedWorktreeId ??
    options.workspaceId ??
    (declared.success ? declared.data.workspaceId : undefined)
  if (declared.success && declared.data.workspaceId && assigned !== declared.data.workspaceId) {
    return false
  }
  if (
    row.worktree_id &&
    options.resolvedWorktreeId &&
    row.worktree_id !== options.resolvedWorktreeId
  ) {
    return false
  }
  return assigned !== undefined && assigned !== workspaceId
}

/** The acceptance transaction reserves custody through existing Dispatch rows, not another lock store. */
export function assertManagerWorkspaceCapacity(
  db: OrchestrationDb,
  hostId: string,
  workspaceId: string
): void {
  if (!db.db.isTransaction) {
    throw new Error('Workspace reservation requires the acceptance transaction')
  }
  const rows = db.db
    .prepare(`SELECT w.worktree_id, w.start_options, d.host_scope
    FROM worker_dispatches w JOIN dispatch_contexts d ON d.id = w.dispatch_id
    WHERE w.state IN ('starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown')
    LIMIT 2001`)
    .all()
  if (
    rows.length > 2000 ||
    rows.some((row) => !availableFor(activeWorker.parse(row), hostId, workspaceId))
  ) {
    throw new ManagerAuthorityError(
      'manager_forbidden',
      'Workspace capacity is occupied or unverifiable; reconcile before starting another worker'
    )
  }
}
