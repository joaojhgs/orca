import { afterEach, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration/db'
import { recordManagerContactEvent } from './manager-contact-event'
import { managerEventPolicyAllows } from './manager-event-policy'

const databases: OrchestrationDb[] = []
afterEach(() => databases.splice(0).forEach((db) => db.close()))
const grant = { executionHostIds: ['ssh:worker'], projectIds: [], runIds: [] }
it('journals contact edges once, keeps loss unverifiable and survives duplicate/reconnect updates', () => {
  const db = new OrchestrationDb(':memory:')
  databases.push(db)
  db.managerPrincipals.issue(
    'Manager',
    { scope: grant, actions: ['events:read'] },
    Date.now() + 60_000
  )
  recordManagerContactEvent(db, 'worker', true, 1)
  recordManagerContactEvent(db, 'worker', false, 2)
  recordManagerContactEvent(db, 'worker', false, 3)
  recordManagerContactEvent(db, 'worker', true, 4)
  const events = db.managerEvents.read(grant).events
  expect(events.map((event) => event.kind)).toEqual(['contact-lost', 'contact-restored'])
  expect(events[0].liveness).toBe('unverifiable')
  expect(events[1].liveness).toBeUndefined()
  expect(db.managerEvents.read({ ...grant, executionHostIds: ['ssh:other'] }).events).toEqual([])
})
it('applies manager subscription mutes at consumption, preserves the journal and advances past muted events', () => {
  const db = new OrchestrationDb(':memory:')
  databases.push(db)
  const input = {
    eventId: 'mail',
    source: 'orchestration-database',
    sourceGeneration: 'one',
    kind: 'mail' as const,
    scope: { executionHostId: 'ssh:worker', actor: 'worker' as const, projectId: 'project' },
    occurredAt: 1,
    summary: 'Untrusted evidence'
  }
  db.managerEvents.append(input)
  const mute = {
    rules: [{ id: 'manager-off', selector: { level: 'server' as const }, manager: false }],
    deviceOverrides: []
  }
  const scope = { ...grant, projectIds: ['project'] }
  const page = db.managerEvents.read(scope, undefined, 100, (event) =>
    managerEventPolicyAllows(mute, event)
  )
  expect(page.events).toEqual([])
  expect(page.cursor.sequence).toBe(1)
  expect(db.managerEvents.read(scope).events).toHaveLength(1)
  expect(
    managerEventPolicyAllows(
      {
        rules: [{ id: 'human-off', selector: { level: 'server' }, human: { mode: 'off' } }],
        deviceOverrides: []
      },
      input
    )
  ).toBe(true)
})
