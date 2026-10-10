import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from '../../sqlite/sync-database'
import { ManagerEventJournal } from './manager-event-journal'
import type { ManagerEventInput, ManagerScopeGrant } from '../../../shared/manager-event-contract'

const databases: Database.Database[] = []
const grant: ManagerScopeGrant = { executionHostIds: ['local'], projectIds: ['p'], runIds: [] }
const event: ManagerEventInput = {
  eventId: 'one',
  source: 'hook',
  sourceGeneration: 'generation',
  kind: 'question',
  scope: { executionHostId: 'local', projectId: 'p', actor: 'root' },
  occurredAt: 1,
  summary: 'question'
}
function fixture() {
  const db = new Database(':memory:')
  databases.push(db)
  return { db, journal: new ManagerEventJournal(db) }
}
afterEach(() => {
  vi.useRealTimers()
  for (const db of databases.splice(0)) {
    db.close()
  }
})
describe('manager event-driven waits', () => {
  it('wakes from committed evidence with no polling timer or model invocation', async () => {
    const { journal } = fixture()
    const after = journal.read(grant).cursor
    const authorize = vi.fn()
    const waiting = journal.wait(grant, after, 1000, authorize)
    journal.append(event)
    expect((await waiting).events.map((e) => e.eventId)).toEqual(['one'])
    expect(authorize).toHaveBeenCalledTimes(3)
  })
  it('does not mistake an enclosing rollback for a committed event', async () => {
    vi.useFakeTimers()
    const { journal, db } = fixture()
    const waiting = journal.wait(grant, journal.read(grant).cursor, 1000, () => {})
    db.exec('BEGIN IMMEDIATE')
    journal.append(event)
    db.exec('ROLLBACK')
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1000)
    expect((await waiting).events).toEqual([])
  })
  it('rechecks revocation before returning newly arrived private evidence', async () => {
    const { journal } = fixture()
    let revoked = false
    const authorize = () => {
      if (revoked) {
        throw new Error('revoked')
      }
    }
    const waiting = journal.wait(grant, journal.read(grant).cursor, 1000, authorize)
    const assertion = expect(waiting).rejects.toThrow('revoked')
    revoked = true
    journal.append(event)
    await assertion
  })
  it('re-resolves Run scope when ownership changes during a long poll', async () => {
    const { journal } = fixture()
    let currentGrant = { ...grant, runIds: ['owned'] }
    const waiting = journal.wait(
      () => currentGrant,
      journal.headCursor(),
      1000,
      () => {}
    )
    currentGrant = { ...grant, runIds: [] }
    journal.append({ ...event, scope: { ...event.scope, runId: 'owned' } })
    expect((await waiting).events).toEqual([])
  })
  it('cleans up on disconnect and permits a replacement waiter', async () => {
    const { journal } = fixture()
    const abort = new AbortController()
    const waiting = journal.wait(grant, undefined, 1000, () => {}, abort.signal)
    const assertion = expect(waiting).rejects.toThrow('cancelled')
    abort.abort()
    await assertion
    const replacement = journal.wait(grant, undefined, 1000, () => {})
    journal.append(event)
    expect((await replacement).events).toHaveLength(1)
  })
  it('advances past an unauthorized event without exposing its body', async () => {
    const { journal } = fixture()
    const waiting = journal.wait(grant, journal.read(grant).cursor, 1000, () => {})
    journal.append({ ...event, scope: { ...event.scope, projectId: 'private' }, summary: 'secret' })
    const result = await waiting
    expect(result.events).toEqual([])
    expect(result.cursor.sequence).toBe(1)
    expect(JSON.stringify(result)).not.toContain('secret')
  })
})
