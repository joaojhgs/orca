import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type Database from '../../sqlite/sync-database'
import { runLifecycleWriteTransaction } from '../orchestration/db/lifecycle-write-transaction-runner'
import { ManagerAuthorityError } from './manager-authority-error'
import {
  ManagerConsumerLeaseSchema,
  ManagerPrincipalGrantSchema,
  type ManagerAction,
  type ManagerConsumerLease,
  type ManagerPrincipal,
  type ManagerPrincipalGrant
} from '../../../shared/manager-principal-contract'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const principalRow = z.object({
  id: z.string(),
  label: z.string(),
  grant_json: z.string(),
  created_at: z.number(),
  expires_at: z.number(),
  revoked_at: z.number().nullable(),
  consumer_id: z.string().nullable(),
  consumer_generation: z.number(),
  lease_until: z.number()
})
type PrincipalRow = z.infer<typeof principalRow>
const publicPrincipal = (row: PrincipalRow): ManagerPrincipal => ({
  id: row.id,
  label: row.label,
  grant: ManagerPrincipalGrantSchema.parse(JSON.parse(row.grant_json)),
  createdAt: row.created_at,
  expiresAt: row.expires_at
})

export class ManagerPrincipalStore {
  constructor(
    private readonly db: Database.Database,
    private readonly now = Date.now
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS manager_principals (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
      grant_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      revoked_at INTEGER, consumer_id TEXT, consumer_generation INTEGER NOT NULL DEFAULT 0,
      lease_until INTEGER NOT NULL DEFAULT 0
    );`)
  }

  issue(label: string, grant: ManagerPrincipalGrant, expiresAt: number) {
    const parsedLabel = z.string().trim().min(1).max(200).parse(label)
    const parsedGrant = ManagerPrincipalGrantSchema.parse(grant)
    const createdAt = this.now()
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= createdAt) {
      throw new Error('Manager credential needs an explicit future expiry')
    }
    const id = `manager_${randomUUID()}`
    const token = `orcam_${randomBytes(32).toString('base64url')}`
    this.db
      .prepare(`INSERT INTO manager_principals
      (id, label, token_hash, grant_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, parsedLabel, digest(token), JSON.stringify(parsedGrant), createdAt, expiresAt)
    return { principal: publicPrincipal(this.requireActive(id)), token }
  }

  authenticate(token: string): ManagerPrincipal | null {
    if (!/^orcam_[A-Za-z0-9_-]{43}$/.test(token)) {
      return null
    }
    const row = this.db
      .prepare('SELECT * FROM manager_principals WHERE token_hash = ?')
      .get(digest(token))
    if (!row) {
      return null
    }
    const parsed = principalRow.parse(row)
    return this.active(parsed) ? publicPrincipal(parsed) : null
  }

  hasActivePrincipal(): boolean {
    return (
      this.db
        .prepare(`SELECT 1 FROM manager_principals
      WHERE revoked_at IS NULL AND expires_at > ? LIMIT 1`)
        .get(this.now()) !== undefined
    )
  }

  listPublic(offset = 0, limit = 50) {
    const rows = this.db
      .prepare(`SELECT * FROM manager_principals
      ORDER BY created_at, id LIMIT ? OFFSET ?`)
      .all(limit + 1, offset)
    const principals = rows.slice(0, limit).map((value) => {
      const row = principalRow.parse(value)
      return {
        id: row.id,
        label: row.label,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        actions: publicPrincipal(row).grant.actions,
        state:
          row.revoked_at !== null
            ? ('revoked' as const)
            : this.active(row)
              ? ('active' as const)
              : ('expired' as const),
        consumerConnected:
          this.active(row) && row.consumer_id !== null && row.lease_until > this.now()
      }
    })
    return { principals, nextOffset: rows.length > limit ? offset + limit : null }
  }

  authorize(id: string, action: ManagerAction): ManagerPrincipal {
    const principal = publicPrincipal(this.requireActive(id))
    if (!principal.grant.actions.includes(action)) {
      throw new ManagerAuthorityError('manager_forbidden', 'Manager action not granted')
    }
    return principal
  }

  revoke(id: string): boolean {
    return (
      Number(
        this.db
          .prepare(`UPDATE manager_principals SET revoked_at = ?,
      consumer_generation = consumer_generation + 1, consumer_id = NULL, lease_until = 0
      WHERE id = ? AND revoked_at IS NULL`)
          .run(this.now(), id).changes
      ) > 0
    )
  }

  claim(id: string, consumerId: string, durationMs = 60_000): ManagerConsumerLease {
    z.string().min(1).max(512).parse(consumerId)
    z.number().int().min(1000).max(60_000).parse(durationMs)
    return runLifecycleWriteTransaction(this.db, 'manager_consumer_claim', () => {
      const row = this.requireActive(id)
      if (row.consumer_id && row.lease_until > this.now()) {
        throw new ManagerAuthorityError(
          'manager_consumer_busy',
          'Manager consumer is already leased'
        )
      }
      this.db
        .prepare(`UPDATE manager_principals SET consumer_id = ?,
        consumer_generation = consumer_generation + 1, lease_until = ? WHERE id = ?`)
        .run(consumerId, Math.min(this.now() + durationMs, row.expires_at), id)
      return { principalId: id, consumerId, generation: row.consumer_generation + 1 }
    })
  }

  renew(lease: ManagerConsumerLease, durationMs = 60_000): void {
    z.number().int().min(1000).max(60_000).parse(durationMs)
    runLifecycleWriteTransaction(this.db, 'manager_consumer_renew', () => {
      const row = this.requireLease(lease)
      this.db
        .prepare('UPDATE manager_principals SET lease_until = ? WHERE id = ?')
        .run(Math.min(this.now() + durationMs, row.expires_at), row.id)
    })
  }

  release(lease: ManagerConsumerLease): void {
    runLifecycleWriteTransaction(this.db, 'manager_consumer_release', () => {
      const row = this.requireLease(lease)
      this.db
        .prepare(`UPDATE manager_principals SET consumer_id = NULL, lease_until = 0,
        consumer_generation = consumer_generation + 1 WHERE id = ?`)
        .run(row.id)
    })
  }

  withLease<T>(lease: ManagerConsumerLease, action: ManagerAction, operation: () => T): T {
    return runLifecycleWriteTransaction(this.db, 'manager_consumer_write', () => {
      this.requireLease(lease)
      this.authorize(lease.principalId, action)
      const result = operation()
      if (
        result &&
        (typeof result === 'object' || typeof result === 'function') &&
        'then' in result
      ) {
        throw new Error('Manager lease transactions require synchronous operations')
      }
      return result
    })
  }

  private requireLease(input: ManagerConsumerLease): PrincipalRow {
    const lease = ManagerConsumerLeaseSchema.parse(input)
    const row = this.requireActive(lease.principalId)
    if (
      row.consumer_id !== lease.consumerId ||
      row.consumer_generation !== lease.generation ||
      row.lease_until <= this.now()
    ) {
      throw new ManagerAuthorityError('manager_consumer_fenced', 'Manager consumer fenced')
    }
    return row
  }

  private requireActive(id: string): PrincipalRow {
    const row = this.db.prepare('SELECT * FROM manager_principals WHERE id = ?').get(id)
    if (!row) {
      throw new ManagerAuthorityError('manager_unauthorized', 'Manager credential is not active')
    }
    const parsed = principalRow.parse(row)
    if (!this.active(parsed)) {
      throw new ManagerAuthorityError('manager_unauthorized', 'Manager credential is not active')
    }
    return parsed
  }

  private active(row: PrincipalRow): boolean {
    return row.revoked_at === null && row.expires_at > this.now()
  }
}
