import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type Database from '../../sqlite/sync-database'
import { runLifecycleWriteTransaction } from '../orchestration/db/lifecycle-write-transaction-runner'
import { waitForManagerEvent } from './manager-event-long-poll'
import {
  ManagerEventCursorSchema,
  ManagerEventInputSchema,
  ManagerScopeGrantSchema,
  managerMayObserve,
  type ManagerEvent,
  type ManagerEventCursor,
  type ManagerEventInput,
  type ManagerEventPage,
  type ManagerScopeGrant
} from '../../../shared/manager-event-contract'

const metadataSchema = z.object({ journal_id: z.string(), pruned_through: z.number() })
const rowSchema = z.object({
  sequence: z.number(),
  event_json: z.string(),
  recorded_at: z.number()
})

function eventFromRow(value: unknown): ManagerEvent {
  const row = rowSchema.parse(value)
  return {
    ...ManagerEventInputSchema.parse(JSON.parse(row.event_json)),
    sequence: row.sequence,
    recordedAt: row.recorded_at
  }
}

/** Delivery history only; Runs, Dispatches and host status remain authoritative. */
export class ManagerEventJournal {
  private readonly listeners = new Set<() => void>()
  constructor(
    private readonly db: Database.Database,
    private readonly now = Date.now
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS manager_event_journal_metadata (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        journal_id TEXT NOT NULL, pruned_through INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS manager_event_journal (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE, event_json TEXT NOT NULL,
        recorded_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS manager_event_checkpoints (
        consumer_id TEXT PRIMARY KEY, journal_id TEXT NOT NULL,
        sequence INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS manager_event_identities (
        event_id TEXT PRIMARY KEY, digest TEXT NOT NULL, sequence INTEGER NOT NULL
      );
    `)
    db.prepare(`INSERT OR IGNORE INTO manager_event_journal_metadata
      (singleton, journal_id) VALUES (1, ?)`).run(randomUUID())
  }

  append(input: ManagerEventInput): {
    event: ManagerEvent | null
    sequence: number
    duplicate: boolean
  } {
    const parsed = ManagerEventInputSchema.parse(input)
    const encoded = JSON.stringify(parsed)
    const digest = createHash('sha256').update(encoded).digest('hex')
    const result = runLifecycleWriteTransaction(this.db, 'manager_event_append', () => {
      const existing = this.db
        .prepare(`SELECT digest, sequence
        FROM manager_event_identities WHERE event_id = ?`)
        .get(parsed.eventId)
      if (existing) {
        const identity = z.object({ digest: z.string(), sequence: z.number() }).parse(existing)
        if (identity.digest !== digest) {
          throw new Error('A manager event identity cannot describe different evidence')
        }
        const row = this.db
          .prepare(`SELECT sequence, event_json, recorded_at
          FROM manager_event_journal WHERE event_id = ?`)
          .get(parsed.eventId)
        return {
          event: row ? eventFromRow(row) : null,
          sequence: identity.sequence,
          duplicate: true
        }
      }
      this.db
        .prepare(`INSERT INTO manager_event_journal
        (event_id, event_json, recorded_at) VALUES (?, ?, ?)`)
        .run(parsed.eventId, encoded, this.now())
      const event = eventFromRow(
        this.db
          .prepare(`SELECT sequence, event_json, recorded_at
        FROM manager_event_journal WHERE event_id = ?`)
          .get(parsed.eventId)
      )
      this.db
        .prepare(`INSERT INTO manager_event_identities (event_id, digest, sequence)
        VALUES (?, ?, ?)`)
        .run(parsed.eventId, digest, event.sequence)
      return { event, sequence: event.sequence, duplicate: false }
    })
    if (!result.duplicate) {
      // An enclosing producer transaction finishes before a waiter can re-read its committed state.
      queueMicrotask(() => {
        for (const listener of this.listeners) {
          listener()
        }
      })
    }
    return result
  }

  wait(
    grant: ManagerScopeGrant | (() => ManagerScopeGrant),
    after: ManagerEventCursor | undefined,
    timeoutMs: number,
    authorize: () => void,
    signal?: AbortSignal,
    acceptEvent?: (event: ManagerEvent) => boolean
  ): Promise<ManagerEventPage> {
    return waitForManagerEvent(
      this.listeners,
      () => {
        authorize()
        return this.read(typeof grant === 'function' ? grant() : grant, after, 100, acceptEvent)
      },
      timeoutMs,
      signal
    )
  }

  headCursor(): ManagerEventCursor {
    return { journalId: this.metadata().journal_id, sequence: this.tail() }
  }

  read(
    grant: ManagerScopeGrant,
    after?: ManagerEventCursor,
    limit = 100,
    acceptEvent?: (event: ManagerEvent) => boolean
  ): ManagerEventPage {
    const allowed = ManagerScopeGrantSchema.parse(grant)
    const cursor = after ? ManagerEventCursorSchema.parse(after) : undefined
    const metadata = this.metadata()
    const gap =
      cursor && cursor.journalId !== metadata.journal_id
        ? 'journal-replaced'
        : cursor && cursor.sequence < metadata.pruned_through
          ? 'retention-expired'
          : null
    let sequence = gap || !cursor ? metadata.pruned_through : cursor.sequence
    const events: ManagerEvent[] = []
    const pageLimit = z.number().int().min(1).max(200).parse(limit)
    if (cursor && !gap && cursor.sequence > this.tail()) {
      throw new Error('Manager cursor is ahead of this journal')
    }
    // Bound work even when most retained events are outside this consumer's grants.
    const rows = this.db
      .prepare(`SELECT sequence, event_json, recorded_at
      FROM manager_event_journal WHERE sequence > ? ORDER BY sequence LIMIT 2000`)
      .all(sequence)
    for (const row of rows) {
      const event = eventFromRow(row)
      sequence = event.sequence
      if (managerMayObserve(allowed, event.scope) && (acceptEvent?.(event) ?? true)) {
        events.push(event)
        if (events.length === pageLimit) {
          break
        }
      }
    }
    const later = this.db
      .prepare(`SELECT sequence FROM manager_event_journal
      WHERE sequence > ? LIMIT 1`)
      .get(sequence)
    return {
      events,
      cursor: { journalId: metadata.journal_id, sequence },
      gap,
      hasMore: later !== undefined
    }
  }

  checkpoint(consumerId: string, cursor: ManagerEventCursor): void {
    z.string().min(1).max(512).parse(consumerId)
    const parsed = ManagerEventCursorSchema.parse(cursor)
    const metadata = this.metadata()
    if (parsed.journalId !== metadata.journal_id || parsed.sequence > this.tail()) {
      throw new Error('Manager checkpoint does not belong to this journal')
    }
    this.db
      .prepare(`INSERT INTO manager_event_checkpoints
      (consumer_id, journal_id, sequence, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(consumer_id) DO UPDATE SET
        journal_id = excluded.journal_id,
        sequence = CASE WHEN manager_event_checkpoints.journal_id = excluded.journal_id
          THEN MAX(manager_event_checkpoints.sequence, excluded.sequence)
          ELSE excluded.sequence END,
        updated_at = excluded.updated_at`)
      .run(consumerId, parsed.journalId, parsed.sequence, this.now())
  }

  getCheckpoint(consumerId: string): ManagerEventCursor | null {
    z.string().min(1).max(512).parse(consumerId)
    const row = this.db
      .prepare(`SELECT journal_id, sequence FROM manager_event_checkpoints
      WHERE consumer_id = ?`)
      .get(consumerId)
    if (!row) {
      return null
    }
    const parsed = z.object({ journal_id: z.string(), sequence: z.number() }).parse(row)
    return { journalId: parsed.journal_id, sequence: parsed.sequence }
  }

  prune(retainCount = 100_000): number {
    const keep = z.number().int().min(2000).max(100_000).parse(retainCount)
    return runLifecycleWriteTransaction(this.db, 'manager_event_prune', () => {
      const boundary = this.db
        .prepare(`SELECT sequence FROM manager_event_journal
        ORDER BY sequence DESC LIMIT 1 OFFSET ?`)
        .get(keep)
      if (!boundary) {
        return 0
      }
      const sequence = z.object({ sequence: z.number() }).parse(boundary).sequence
      const result = this.db
        .prepare('DELETE FROM manager_event_journal WHERE sequence <= ?')
        .run(sequence)
      this.db
        .prepare(`UPDATE manager_event_journal_metadata
        SET pruned_through = MAX(pruned_through, ?) WHERE singleton = 1`)
        .run(sequence)
      return Number(result.changes)
    })
  }

  private tail(): number {
    return z
      .object({ sequence: z.number() })
      .parse(
        this.db
          .prepare('SELECT COALESCE(MAX(sequence), ?) AS sequence FROM manager_event_journal')
          .get(this.metadata().pruned_through)
      ).sequence
  }

  private metadata() {
    return metadataSchema.parse(
      this.db
        .prepare(`SELECT journal_id, pruned_through
      FROM manager_event_journal_metadata WHERE singleton = 1`)
        .get()
    )
  }
}
