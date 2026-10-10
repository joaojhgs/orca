import { z } from 'zod'
import type Database from '../../sqlite/sync-database'
import type { RunRow } from '../orchestration/types'
import {
  ManagerEventScopeSchema,
  managerMayObserve,
  type ManagerEventScope,
  type ManagerScopeGrant
} from '../../../shared/manager-event-contract'
import { ManagerAuthorityError } from './manager-authority-error'

const bindingRow = z.object({
  run_id: z.string(),
  principal_id: z.string(),
  scope_json: z.string(),
  run_generation: z.number()
})

/** Only ownership metadata; task state continues to live in Orca's Runs. */
export class ManagerRunOwnership {
  constructor(private readonly db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS manager_run_ownership (
      run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
      principal_id TEXT NOT NULL REFERENCES manager_principals(id),
      scope_json TEXT NOT NULL, run_generation INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS manager_run_owner ON manager_run_ownership(principal_id);`)
  }

  registerCreatedRun(principalId: string, run: RunRow, scope: ManagerEventScope): void {
    if (!this.serviceOwned(run)) {
      throw new ManagerAuthorityError('manager_forbidden', 'Run has another coordinator')
    }
    const parsed = ManagerEventScopeSchema.parse(scope)
    if (!parsed.workspaceId || parsed.runId || parsed.dispatchId || parsed.actor !== 'root') {
      throw new Error('Manager Run requires a canonical workspace scope')
    }
    this.db
      .prepare(`INSERT INTO manager_run_ownership
      (run_id, principal_id, scope_json, run_generation) VALUES (?, ?, ?, ?)`)
      .run(run.id, principalId, JSON.stringify(parsed), run.consumer_generation)
  }

  requireOwnedRun(principalId: string, run: RunRow | undefined, grant: ManagerScopeGrant) {
    const value =
      run &&
      this.db
        .prepare(`SELECT run_id, principal_id, scope_json, run_generation
      FROM manager_run_ownership WHERE run_id = ? AND principal_id = ?`)
        .get(run.id, principalId)
    if (!value || !run) {
      throw new ManagerAuthorityError('manager_forbidden', 'Run is not owned by this manager')
    }
    const binding = bindingRow.parse(value)
    const scope = ManagerEventScopeSchema.parse(JSON.parse(binding.scope_json))
    if (!this.serviceOwned(run) || run.consumer_generation !== binding.run_generation) {
      throw new ManagerAuthorityError('manager_consumer_fenced', 'Run coordinator was replaced')
    }
    if (!managerMayObserve(grant, scope)) {
      throw new ManagerAuthorityError('manager_forbidden', 'Run scope is outside the grant')
    }
    return scope
  }

  observationGrant(principalId: string, grant: ManagerScopeGrant): ManagerScopeGrant {
    const rows = this.db
      .prepare(`SELECT o.run_id FROM manager_run_ownership o
      JOIN runs r ON r.id = o.run_id
      WHERE o.principal_id = ? AND r.consumer_generation = o.run_generation
        AND r.coordinator_handle IS NULL AND r.coordinator_pane_key IS NULL
        AND r.coordinator_orca_session_id IS NULL ORDER BY o.run_id LIMIT 1001`)
      .all(principalId)
    const ids = rows.map((row) => z.object({ run_id: z.string() }).parse(row).run_id)
    const runIds = [...new Set([...grant.runIds, ...ids])]
    if (runIds.length > 1000) {
      throw new ManagerAuthorityError('manager_forbidden', 'Manager Run scope capacity reached')
    }
    return { ...grant, runIds }
  }

  ownedScopes(principalId: string, grant: ManagerScopeGrant) {
    const rows = this.db
      .prepare(`SELECT o.run_id, o.scope_json FROM manager_run_ownership o
      JOIN runs r ON r.id = o.run_id
      WHERE o.principal_id = ? AND r.consumer_generation = o.run_generation
        AND r.coordinator_handle IS NULL AND r.coordinator_pane_key IS NULL
        AND r.coordinator_orca_session_id IS NULL AND r.legacy = 0
      ORDER BY o.run_id LIMIT 1001`)
      .all(principalId)
    if (rows.length > 1000) {
      throw new ManagerAuthorityError('manager_forbidden', 'Manager Run scope capacity reached')
    }
    return rows.flatMap((row) => {
      const binding = z.object({ run_id: z.string(), scope_json: z.string() }).parse(row)
      const scope = ManagerEventScopeSchema.parse(JSON.parse(binding.scope_json))
      return managerMayObserve(grant, scope) ? [{ runId: binding.run_id, scope }] : []
    })
  }

  private serviceOwned(run: RunRow): boolean {
    return (
      run.coordinator_handle === null &&
      run.coordinator_pane_key === null &&
      run.coordinator_orca_session_id === null &&
      run.legacy === 0
    )
  }

  eventScope(run: RunRow): ManagerEventScope | null {
    const value = this.db
      .prepare(`SELECT run_id, principal_id, scope_json, run_generation
      FROM manager_run_ownership WHERE run_id = ?`)
      .get(run.id)
    if (!value || !this.serviceOwned(run)) {
      return null
    }
    const binding = bindingRow.parse(value)
    return run.consumer_generation === binding.run_generation
      ? ManagerEventScopeSchema.parse(JSON.parse(binding.scope_json))
      : null
  }
}
