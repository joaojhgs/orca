import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import type { ManagerPrincipalGrant } from '../../../shared/manager-principal-contract'
import { ManagerPrincipalStore } from './manager-principal-store'

const databases: Database.Database[] = []
const grant: ManagerPrincipalGrant = {
  scope: { executionHostIds: ['ssh:worker'], projectIds: ['project'], runIds: [] },
  actions: ['events:read', 'events:checkpoint']
}
function fixture() {
  const db = new Database(':memory:')
  databases.push(db)
  let now = 100_000
  const store = new ManagerPrincipalStore(db, () => now)
  const credential = store.issue('Hermes', grant, now + 100_000)
  return {
    db,
    store,
    ...credential,
    advance: (ms: number) => {
      now += ms
    }
  }
}
afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close()
  }
})

describe('manager service credentials', () => {
  it('refuses asynchronous work inside a lease transaction', () => {
    const { store, principal, db } = fixture()
    const lease = store.claim(principal.id, 'adapter')
    db.exec('CREATE TABLE receipt (id TEXT)')
    expect(() =>
      store.withLease(lease, 'events:checkpoint', () => {
        db.prepare('INSERT INTO receipt VALUES (?)').run('should-roll-back')
        return Promise.resolve(true)
      })
    ).toThrow(/synchronous/)
    expect(db.prepare('SELECT * FROM receipt').all()).toEqual([])
  })
  it('stores only a token digest and authenticates only the issued credential', () => {
    const { db, store, token, principal } = fixture()
    expect(store.authenticate(token)).toEqual(principal)
    expect(store.authenticate(`${token}x`)).toBeNull()
    expect(store.authenticate('owner-token')).toBeNull()
    const serialized = JSON.stringify(db.prepare('SELECT * FROM manager_principals').all())
    expect(serialized).not.toContain(token)
    expect(serialized).not.toContain(token.slice(6))
    expect(principal).not.toHaveProperty('token_hash')
  })

  it('cannot silently grant destructive actions or broaden a scope', () => {
    const { store, principal } = fixture()
    expect(() => store.authorize(principal.id, 'worker:start')).toThrow(/not granted/)
    expect(() =>
      store.issue(
        'bad',
        {
          ...grant,
          actions: JSON.parse('["exec"]')
        },
        200_000
      )
    ).toThrow()
    expect(store.authorize(principal.id, 'events:read').grant.scope.projectIds).toEqual(['project'])
  })

  it('revokes immediately, including an already leased consumer', () => {
    const { store, principal, token } = fixture()
    const lease = store.claim(principal.id, 'adapter')
    expect(store.revoke(principal.id)).toBe(true)
    expect(store.authenticate(token)).toBeNull()
    expect(() => store.withLease(lease, 'events:checkpoint', () => true)).toThrow()
    expect(store.revoke(principal.id)).toBe(false)
  })

  it('expires credentials and leases even if a client keeps its old snapshot', () => {
    const { store, principal, token, advance } = fixture()
    const lease = store.claim(principal.id, 'adapter')
    advance(100_001)
    expect(store.authenticate(token)).toBeNull()
    expect(() => store.authorize(principal.id, 'events:read')).toThrow()
    expect(() => store.renew(lease)).toThrow()
  })

  it('allows exactly one consumer and never reuses a generation after expiry', () => {
    const { store, principal, advance } = fixture()
    const first = store.claim(principal.id, 'one', 1000)
    expect(() => store.claim(principal.id, 'one')).toThrow(/already leased/)
    expect(() => store.claim(principal.id, 'two')).toThrow(/already leased/)
    advance(1001)
    const second = store.claim(principal.id, 'two')
    expect(second.generation).toBeGreaterThan(first.generation)
    expect(() => store.renew(first)).toThrow(/fenced/)
    expect(() => store.release(first)).toThrow(/fenced/)
    expect(store.withLease(second, 'events:checkpoint', () => 42)).toBe(42)
  })

  it('rejects a consumer id or generation substituted by another process', () => {
    const { store, principal } = fixture()
    const lease = store.claim(principal.id, 'one')
    expect(() => store.renew({ ...lease, consumerId: 'two' })).toThrow(/fenced/)
    expect(() => store.renew({ ...lease, generation: lease.generation + 1 })).toThrow(/fenced/)
  })

  it('renewal preserves the fencing generation and release invalidates it', () => {
    const { store, principal, advance } = fixture()
    const lease = store.claim(principal.id, 'one', 1000)
    advance(500)
    store.renew(lease, 1000)
    advance(501)
    expect(store.withLease(lease, 'events:checkpoint', () => true)).toBe(true)
    store.release(lease)
    const next = store.claim(principal.id, 'two')
    expect(next.generation).toBeGreaterThan(lease.generation)
    expect(() => store.withLease(lease, 'events:checkpoint', () => true)).toThrow(/fenced/)
  })

  it('rolls back a checkpoint operation that fails without releasing the consumer', () => {
    const { db, store, principal } = fixture()
    db.exec('CREATE TABLE markers (value TEXT)')
    const lease = store.claim(principal.id, 'one')
    expect(() =>
      store.withLease(lease, 'events:checkpoint', () => {
        db.prepare('INSERT INTO markers VALUES (?)').run('effect')
        throw new Error('failed')
      })
    ).toThrow(/failed/)
    expect(db.prepare('SELECT * FROM markers').all()).toEqual([])
    expect(store.withLease(lease, 'events:checkpoint', () => 1)).toBe(1)
  })

  it.each([Number.NaN, Infinity, 100_000, 99_999])(
    'requires a future finite expiry %s',
    (expiry) => {
      expect(() => fixture().store.issue('test', grant, expiry)).toThrow()
    }
  )
})
