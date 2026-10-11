import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { OrchestrationDb } from '../orchestration/db'
import { runLifecycleWriteTransaction } from '../orchestration/db/lifecycle-write-transaction-runner'
import { ManagerAuthorityError } from './manager-authority-error'

const targetSchema = z.strictObject({
  runId: z.string(),
  taskId: z.string(),
  workspaceId: z.string(),
  agent: z.string(),
  model: z.string().optional(),
  workClass: z.enum(['edit', 'build'])
})
export const dispatchWaitRow = z.object({
  principal_id: z.string(),
  request_id: z.string(),
  payload_hash: z.string(),
  target_json: z.string(),
  execution_host_id: z.string(),
  event_id: z.string(),
  created_at: z.number(),
  state: z.enum(['waiting', 'notified'])
})
export type ManagerDispatchWait = z.infer<typeof dispatchWaitRow>

/** Retry observations only: no credentials, leases, worker lifecycle or launch authority. */
export function createManagerDispatchWaitTable(db: OrchestrationDb['db']): void {
  db.exec(`CREATE TABLE IF NOT EXISTS manager_dispatch_waits (
    principal_id TEXT NOT NULL REFERENCES manager_principals(id), request_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL, target_json TEXT NOT NULL, execution_host_id TEXT NOT NULL,
    event_id TEXT NOT NULL, created_at INTEGER NOT NULL, last_checked_at INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL CHECK(state IN ('waiting', 'notified')),
    PRIMARY KEY(principal_id, request_id)
  );`)
}

export function readManagerDispatchWaitTarget(row: ManagerDispatchWait) {
  return targetSchema.parse(JSON.parse(row.target_json))
}

export function queueManagerDispatchWait(
  db: OrchestrationDb,
  principalId: string,
  requestId: string,
  payloadHash: string,
  executionHostId: string,
  target: z.infer<typeof targetSchema>
): void {
  const parsed = targetSchema.parse(target)
  runLifecycleWriteTransaction(db.db, 'manager_dispatch_wait', () => {
    const receipt = db.getMutationReceipt(`manager:${principalId}`, requestId)
    if (receipt) {
      return
    }
    db.db
      .prepare(`DELETE FROM manager_dispatch_waits WHERE principal_id = ? AND request_id != ?
      AND json_extract(target_json, '$.taskId') = ?`)
      .run(principalId, requestId, parsed.taskId)
    const existing = db.db
      .prepare('SELECT * FROM manager_dispatch_waits WHERE principal_id = ? AND request_id = ?')
      .get(principalId, requestId)
    if (existing) {
      const row = dispatchWaitRow.parse(existing)
      if (row.payload_hash !== payloadHash) {
        throw new ManagerAuthorityError(
          'manager_forbidden',
          'Pending capacity request cannot change its input'
        )
      }
      if (row.state === 'waiting') {
        return
      }
    } else {
      const count = z
        .object({ count: z.number() })
        .parse(db.db.prepare('SELECT COUNT(*) AS count FROM manager_dispatch_waits').get())
      if (count.count >= 200) {
        throw new ManagerAuthorityError('manager_forbidden', 'Capacity wait inventory is full')
      }
    }
    db.db
      .prepare(`INSERT INTO manager_dispatch_waits
      (principal_id, request_id, payload_hash, target_json, execution_host_id, event_id, created_at, state)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting')
      ON CONFLICT(principal_id, request_id) DO UPDATE SET state = 'waiting', event_id = excluded.event_id,
      created_at = excluded.created_at, last_checked_at = 0`)
      .run(
        principalId,
        requestId,
        payloadHash,
        JSON.stringify(parsed),
        executionHostId,
        `manager-capacity:${randomUUID()}`,
        Date.now()
      )
  })
}

export function clearManagerDispatchWait(
  db: OrchestrationDb,
  principalId: string,
  requestId: string
): void {
  db.db
    .prepare('DELETE FROM manager_dispatch_waits WHERE principal_id = ? AND request_id = ?')
    .run(principalId, requestId)
}

export function clearManagerTaskDispatchWaits(
  db: OrchestrationDb,
  principalId: string,
  taskId: string
): void {
  db.db
    .prepare(
      "DELETE FROM manager_dispatch_waits WHERE principal_id = ? AND json_extract(target_json, '$.taskId') = ?"
    )
    .run(principalId, taskId)
}

export function assertManagerDispatchWaitInput(
  db: OrchestrationDb,
  principalId: string,
  requestId: string,
  payloadHash: string
): void {
  const value = db.db
    .prepare('SELECT * FROM manager_dispatch_waits WHERE principal_id = ? AND request_id = ?')
    .get(principalId, requestId)
  if (value && dispatchWaitRow.parse(value).payload_hash !== payloadHash) {
    throw new ManagerAuthorityError(
      'manager_forbidden',
      'Pending capacity request cannot change its input'
    )
  }
}
