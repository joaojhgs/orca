import { z } from 'zod'
import type { OrchestrationDb } from '../orchestration/db'
import { runLifecycleWriteTransaction } from '../orchestration/db/lifecycle-write-transaction-runner'
import { toSshExecutionHostId } from '../../../shared/execution-host'

export function recordManagerContactEvent(
  db: OrchestrationDb,
  targetId: string,
  connected: boolean,
  now = Date.now()
): void {
  if (!db.managerPrincipals.hasActivePrincipal()) {
    return
  }
  runLifecycleWriteTransaction(db.db, 'manager_contact_change', () => {
    db.db.exec(`CREATE TABLE IF NOT EXISTS manager_execution_contacts (
      host_id TEXT PRIMARY KEY, connected INTEGER NOT NULL, generation INTEGER NOT NULL
    )`)
    const hostId = toSshExecutionHostId(targetId)
    const raw = db.db
      .prepare('SELECT connected, generation FROM manager_execution_contacts WHERE host_id = ?')
      .get(hostId)
    const prior = raw
      ? z.object({ connected: z.number(), generation: z.number() }).parse(raw)
      : null
    if (prior?.connected === Number(connected)) {
      return
    }
    const generation = (prior?.generation ?? 0) + 1
    db.db
      .prepare(`INSERT INTO manager_execution_contacts (host_id, connected, generation) VALUES (?, ?, ?)
      ON CONFLICT(host_id) DO UPDATE SET connected = excluded.connected, generation = excluded.generation`)
      .run(hostId, Number(connected), generation)
    if (!prior && connected) {
      return
    }
    db.managerEvents.append({
      eventId: `contact:${hostId}:${generation}`,
      source: 'controller-execution-contact',
      sourceGeneration: `${hostId}:${generation}`,
      kind: connected ? 'contact-restored' : 'contact-lost',
      occurredAt: now,
      scope: { executionHostId: hostId, actor: 'root' },
      summary: connected
        ? 'Execution host contact restored; reconcile original work.'
        : 'Execution host contact unavailable; process liveness is unverifiable.',
      ...(!connected ? { liveness: 'unverifiable' as const } : {})
    })
  })
}
