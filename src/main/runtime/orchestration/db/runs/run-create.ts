import type { RunRow } from '../orchestration-records'
import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import type { OrcaSessionId } from '../../../../../shared/agent-session/identity/orca-session-address'
import { mailboxAddressOf } from '../../addressing/orchestration-caller-identity'
import { runLifecycleWriteTransaction } from '../lifecycle-write-transaction-runner'

type RunCoordinatorParams = {
  objective: string
  coordinatorHandle: string | null
  coordinatorPaneKey: string | null
  /** The coordinator's bare Orca session id when it is a structured session; see orca-session-address. */
  coordinatorOrcaSessionId?: OrcaSessionId | null
}

export function createRun(this: OrchestrationDb, params: RunCoordinatorParams): RunRow {
  const id = generateId('run')
  return runLifecycleWriteTransaction(this.db, 'run_create', () => {
    this.insertRunRow(id, params)
    const run = this.getRun(id)
    if (!run) {
      throw new Error('Created Run is missing')
    }
    return run
  })
}

/** Writes a Run bound to its coordinator inside the caller's transaction. */
export function insertRunRow(
  this: OrchestrationDb,
  id: string,
  params: RunCoordinatorParams
): void {
  const coordinator = {
    terminalHandle: params.coordinatorHandle,
    paneKey: params.coordinatorPaneKey,
    orcaSessionId: params.coordinatorOrcaSessionId ?? null
  }
  this.db
    .prepare(
      `INSERT INTO runs (
         id, objective, coordinator_handle, coordinator_pane_key, coordinator_orca_session_id,
         coordinator_orca_session_id_generation, consumer_generation, legacy
       ) VALUES (?, ?, ?, ?, ?, 1, 1, 0)`
    )
    .run(
      id,
      params.objective,
      coordinator.terminalHandle,
      coordinator.paneKey,
      coordinator.orcaSessionId
    )
  const address = mailboxAddressOf(coordinator)
  if (address !== null) {
    this.rememberRunCoordinatorHandle(id, address)
  }
}

export type RunCreateMethods = {
  createRun: typeof createRun
  insertRunRow: typeof insertRunRow
}

export function attachRunCreate(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    createRun,
    insertRunRow
  })
}
