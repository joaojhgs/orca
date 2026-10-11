import { z } from 'zod'
import type { OrchestrationDb } from '../orchestration/db'
import type { ExecutionAccountUsage } from '../../../shared/execution-observer'
import type { EnrichedAgentHookEventPayload } from '../../agent-hooks/server/server-types'
import { getConnectionExecutionHostId, toSshExecutionHostId } from '../../../shared/execution-host'
import { parseWorkerTerminalHostScope } from '../../../shared/worker-terminal-host-scope'
import { ManagerEventScopeSchema } from '../../../shared/manager-event-contract'
import {
  ManagerDispatchReservationSchema,
  type ManagerDispatchPolicy,
  type ManagerDispatchReservation
} from '../../../shared/manager-dispatch-capacity-contract'
import type { ManagerResourceSample } from './manager-dispatch-resource-sample'
import { ManagerCapacityUnavailableError } from './manager-authority-error'

const rowSchema = z.object({
  start_options: z.string(),
  host_scope: z.string().nullable(),
  assignee_pane_key: z.string().nullable(),
  agent_terminal_handle: z.string().nullable()
})
const optionsSchema = z.object({
  managerScope: ManagerEventScopeSchema.optional(),
  agent: z.string().nullable().optional(),
  managerDispatchReservation: ManagerDispatchReservationSchema.optional()
})

export function assertManagerDispatchCapacity(
  db: OrchestrationDb,
  reservation: ManagerDispatchReservation,
  account: ExecutionAccountUsage,
  sample: ManagerResourceSample,
  policy: ManagerDispatchPolicy,
  statuses: readonly EnrichedAgentHookEventPayload[],
  now: number
): void {
  if (!db.db.isTransaction) {
    throw new Error('Dispatch capacity needs the acceptance transaction')
  }
  if (
    sample.executionHostId !== reservation.executionHostId ||
    sample.observedAt > now + 5000 ||
    now - sample.observedAt > 30_000 ||
    !Number.isFinite(sample.host.availableMemory) ||
    !Number.isFinite(sample.host.totalMemory) ||
    sample.host.totalMemory <= 0 ||
    sample.host.availableMemory > sample.host.totalMemory ||
    sample.host.availableMemory < 0 ||
    !Number.isFinite(sample.host.cpuCoreCount) ||
    sample.host.cpuCoreCount < 1 ||
    !Number.isFinite(sample.host.loadAverage1m) ||
    sample.host.loadAverage1m < 0 ||
    sample.host.loadAverage1m > sample.host.cpuCoreCount * 2
  ) {
    throw new ManagerCapacityUnavailableError(
      'Execution-host sample is stale, invalid or CPU capacity is contended'
    )
  }
  const rows = db.db
    .prepare(`SELECT w.start_options, d.host_scope, d.assignee_pane_key, w.agent_terminal_handle
    FROM worker_dispatches w JOIN dispatch_contexts d ON d.id = w.dispatch_id
    WHERE w.state IN ('starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown') LIMIT 2001`)
    .all()
  if (rows.length > 2000) {
    throw new ManagerCapacityUnavailableError('Worker inventory exceeds its bounded capacity check')
  }
  let hostWorkers = 0,
    buildWorkers = 0,
    accountWorkers = 0,
    heldMemory = 0
  const supervisedPanes = new Set<string>(),
    supervisedHandles = new Set<string>()
  const accountHosts = new Set(account.sources.map((source) => source.executionHostId))
  for (const value of rows) {
    const row = rowSchema.parse(value)
    let options
    try {
      options = optionsSchema.parse(JSON.parse(row.start_options))
    } catch {
      throw new ManagerCapacityUnavailableError(
        'Worker reservation is unverifiable; reconcile it before dispatch'
      )
    }
    const host = parseWorkerTerminalHostScope(row.host_scope)
    const actual =
      host?.kind === 'ssh'
        ? toSshExecutionHostId(host.targetId)
        : host?.kind === 'local' || host?.kind === 'wsl'
          ? 'local'
          : null
    const declared =
      options.managerScope?.executionHostId ?? options.managerDispatchReservation?.executionHostId
    if ((actual && declared && actual !== declared) || !(actual ?? declared)) {
      throw new ManagerCapacityUnavailableError(
        'Worker placement is unverifiable; its capacity remains reserved'
      )
    }
    const hostId = actual ?? declared
    if (row.assignee_pane_key) {
      supervisedPanes.add(`${hostId}:${row.assignee_pane_key}`)
    }
    if (row.agent_terminal_handle) {
      supervisedHandles.add(`${hostId}:${row.agent_terminal_handle}`)
    }
    const held = options.managerDispatchReservation
    if (hostId === reservation.executionHostId) {
      hostWorkers++
      if (held?.workClass !== 'edit') {
        buildWorkers++
      }
      heldMemory += held?.memoryBytes ?? policy.buildMemoryBytes
    }
    if (
      held
        ? held.accountId === account.id
        : hostId &&
          accountHosts.has(hostId) &&
          (!options.agent || options.agent === account.provider)
    ) {
      accountWorkers++
    }
  }
  const untracked = new Set<string>()
  for (const event of statuses) {
    const hostId = getConnectionExecutionHostId(event.connectionId)
    if (
      event.providerSessionOnly ||
      !accountHosts.has(hostId) ||
      (event.source && event.source !== account.provider) ||
      (event.payload.state === 'done' &&
        !event.restoredUnconfirmed &&
        !event.retainedForLiveness &&
        !event.isReplay) ||
      supervisedPanes.has(`${hostId}:${event.paneKey}`) ||
      (event.terminalHandle && supervisedHandles.has(`${hostId}:${event.terminalHandle}`))
    ) {
      continue
    }
    untracked.add(`${hostId}:${event.providerSession?.id ?? event.paneKey}`)
  }
  if (
    hostWorkers >= policy.maxHostWorkers ||
    (reservation.workClass === 'build' && buildWorkers >= policy.maxHostBuildWorkers) ||
    accountWorkers + untracked.size >= policy.maxAccountWorkers ||
    sample.host.availableMemory <
      heldMemory + reservation.memoryBytes + policy.minimumAvailableMemoryBytes
  ) {
    throw new ManagerCapacityUnavailableError(
      'Host/account editing-build capacity is reserved or insufficient; reconcile before dispatch'
    )
  }
}
