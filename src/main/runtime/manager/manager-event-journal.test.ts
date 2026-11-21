import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import type { ManagerEventInput, ManagerScopeGrant } from '../../../shared/manager-event-contract'
import { ManagerEventJournal } from './manager-event-journal'

const databases: Database.Database[] = []
const directories: string[] = []
const grant: ManagerScopeGrant = {
  executionHostIds: ['ssh:worker'],
  projectIds: ['project'],
  runIds: ['run']
}
const input = (id = 'one'): ManagerEventInput => ({
  eventId: id,
  source: 'hook-store',
  sourceGeneration: 'launch-1',
  kind: 'question',
  scope: { executionHostId: 'ssh:worker', projectId: 'project', runId: 'run', actor: 'worker' },
  occurredAt: 100,
  summary: 'Question is untrusted evidence, not authorization.'
})
function open(path = ':memory:') {
  const db = new Database(path)
  databases.push(db)
  return { db, journal: new ManagerEventJournal(db, () => 200) }
}
afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close()
  }
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('durable manager events', () => {
  it('deduplicates evidence and refuses identity substitution', () => {
    const { journal } = open()
    expect(journal.append(input()).duplicate).toBe(false)
    expect(journal.append(input()).duplicate).toBe(true)
    expect(() => journal.append({ ...input(), summary: 'different' })).toThrow(/identity/)
    expect(journal.read(grant).events).toHaveLength(1)
  })

  it('replays more than the mobile in-memory replay window after reopening', () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-manager-journal-'))
    directories.push(directory)
    const path = join(directory, 'journal.db')
    const first = open(path)
    for (let n = 0; n < 600; n++) {
      first.journal.append(input(String(n)))
    }
    const page = first.journal.read(grant, undefined, 100)
    first.journal.checkpoint('manager', page.cursor)
    first.db.close()
    databases.splice(databases.indexOf(first.db), 1)
    const { journal } = open(path)
    let cursor = journal.getCheckpoint('manager') ?? undefined
    const replayed: string[] = []
    for (;;) {
      const next = journal.read(grant, cursor, 200)
      expect(next.gap).toBeNull()
      replayed.push(...next.events.map((event) => event.eventId))
      cursor = next.cursor
      if (!next.hasMore) {
        break
      }
    }
    expect(replayed).toHaveLength(500)
    expect(new Set(replayed).size).toBe(500)
  })

  it('never exposes events outside any of the granted host, project, or Run scopes', () => {
    const { journal } = open()
    const event = input()
    journal.append(event)
    journal.append({ ...input('host'), scope: { ...event.scope, executionHostId: 'ssh:other' } })
    journal.append({ ...input('project'), scope: { ...event.scope, projectId: 'other' } })
    journal.append({ ...input('run'), scope: { ...event.scope, runId: 'other' } })
    journal.append({
      ...input('unscoped'),
      scope: { executionHostId: 'ssh:worker', actor: 'manager' }
    })
    expect(journal.read(grant).events.map((e) => e.eventId)).toEqual(['one'])
    expect(journal.read({ ...grant, projectIds: [] }).events).toEqual([])
  })

  it('advances across filtered events with bounded work and no skipped allowed events', () => {
    const { journal } = open()
    for (let n = 0; n < 2001; n++) {
      journal.append({ ...input(String(n)), scope: { ...input().scope, projectId: 'other' } })
    }
    journal.append(input('visible'))
    const first = journal.read(grant)
    expect(first.events).toEqual([])
    expect(first.cursor.sequence).toBe(2000)
    expect(first.hasMore).toBe(true)
    expect(journal.read(grant, first.cursor).events.map((e) => e.eventId)).toEqual(['visible'])
  })

  it('reports a retention gap and cannot replay a pruned identity as new work', () => {
    const { journal } = open()
    const first = journal.append(input('first'))
    const cursor = journal.read(grant).cursor
    for (let n = 0; n < 2200; n++) {
      journal.append(input(String(n)))
    }
    expect(journal.prune(2000)).toBe(201)
    const replay = journal.read(grant, cursor)
    expect(replay.gap).toBe('retention-expired')
    expect(replay.events[0].sequence).toBe(202)
    expect(journal.append(input('first'))).toEqual({
      event: null,
      sequence: first.sequence,
      duplicate: true
    })
    expect(() => journal.append({ ...input('first'), summary: 'replacement' })).toThrow()
  })

  it('reports journal replacement and rejects foreign or future checkpoints', () => {
    const a = open().journal
    const b = open().journal
    a.append(input())
    const cursor = a.read(grant).cursor
    expect(b.read(grant, cursor).gap).toBe('journal-replaced')
    expect(() => b.checkpoint('consumer', cursor)).toThrow()
    expect(() => a.checkpoint('consumer', { ...cursor, sequence: 999 })).toThrow()
    expect(() => a.read(grant, { ...cursor, sequence: 999 })).toThrow()
  })

  it('checkpoints monotonically without acknowledging events just from reading', () => {
    const { journal } = open()
    journal.append(input())
    const first = journal.read(grant).cursor
    expect(journal.getCheckpoint('consumer')).toBeNull()
    journal.checkpoint('consumer', first)
    journal.checkpoint('consumer', { ...first, sequence: 0 })
    expect(journal.getCheckpoint('consumer')).toEqual(first)
  })

  it('participates in producer transactions without committing their other effects', () => {
    const { journal, db } = open()
    db.exec('BEGIN IMMEDIATE')
    journal.append(input())
    expect(db.isTransaction).toBe(true)
    db.exec('ROLLBACK')
    expect(journal.read(grant).events).toEqual([])
    expect(journal.append(input()).duplicate).toBe(false)
  })

  it.each([Number.NaN, Infinity, 0, -1, 201, 1.2])('refuses invalid page size %s', (limit) => {
    expect(() => open().journal.read(grant, undefined, limit)).toThrow()
  })
})
