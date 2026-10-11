import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration/db'
import {
  ManagerDispatchPolicySchema,
  type ManagerDispatchReservation
} from '../../../shared/manager-dispatch-capacity-contract'
import { runLifecycleWriteTransaction } from '../orchestration/db/lifecycle-write-transaction-runner'
import { assertManagerDispatchCapacity } from './manager-dispatch-capacity'
import { dispatchAccount, dispatchHost } from './manager-dispatch.test-fixture'
import type { EnrichedAgentHookEventPayload } from '../../agent-hooks/server/server-types'

const now = 1000_000,
  policy = ManagerDispatchPolicySchema.parse({})
const databases: OrchestrationDb[] = []
afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close()
  }
})

function fixture() {
  const db = new OrchestrationDb(':memory:')
  databases.push(db)
  const reservation: ManagerDispatchReservation = {
    executionHostId: 'ssh:worker',
    accountId: 'shared-account',
    workClass: 'build',
    memoryBytes: policy.buildMemoryBytes,
    observedAt: now
  }
  const account = dispatchAccount(now)
  const sample = { executionHostId: 'ssh:worker', observedAt: now, host: { ...dispatchHost } }
  const check = (statuses: EnrichedAgentHookEventPayload[] = [], p = policy) =>
    runLifecycleWriteTransaction(db.db, 'capacity_test', () =>
      assertManagerDispatchCapacity(db, reservation, account, sample, p, statuses, now)
    )
  const hold = (host = 'ssh:worker', workClass: 'edit' | 'build' = 'build') => {
    const task = db.createTask({ runId: 'run_legacy_local', spec: 'Existing work' })
    return db.createStartingWorkerDispatch({
      creator: { kind: 'system' },
      maxDepth: 2,
      taskId: task.id,
      startOptions: {
        agent: 'codex',
        managerScope: { executionHostId: host, actor: 'root' },
        managerDispatchReservation: { ...reservation, executionHostId: host, workClass }
      }
    })
  }
  return { db, reservation, sample, check, hold }
}

describe('transactional manager resource reservations', () => {
  it('requires the acceptance transaction and enough measured host headroom', () => {
    const f = fixture()
    expect(f.check).not.toThrow()
    expect(() =>
      assertManagerDispatchCapacity(
        f.db,
        f.reservation,
        dispatchAccount(now),
        f.sample,
        policy,
        [],
        now
      )
    ).toThrow('transaction')
    f.sample.host.availableMemory = policy.buildMemoryBytes
    expect(f.check).toThrow('insufficient')
  })

  it('serializes builds per host while allowing independent edit capacity and cross-host work', () => {
    const f = fixture()
    f.hold()
    expect(f.check).toThrow('reserved')
    f.reservation.workClass = 'edit'
    f.reservation.memoryBytes = policy.editMemoryBytes
    expect(f.check).not.toThrow()
    f.reservation.executionHostId = 'ssh:second'
    f.sample.executionHostId = 'ssh:second'
    f.reservation.workClass = 'build'
    expect(f.check).not.toThrow()
  })

  it('holds ambiguous starts and counts the same account across hosts and unrelated coordinators', () => {
    const f = fixture()
    const one = f.hold('ssh:second', 'edit')
    f.db.db
      .prepare("UPDATE worker_dispatches SET state = 'start_unknown' WHERE dispatch_id = ?")
      .run(one.dispatch.id)
    expect(() => f.check([], { ...policy, maxAccountWorkers: 1 })).toThrow('reserved')
  })

  it('counts current/unverifiable user sessions but not historical provider-only or confirmed done rows', () => {
    const f = fixture()
    const event: EnrichedAgentHookEventPayload = {
      connectionId: 'second',
      source: 'codex',
      paneKey: 'user-pane',
      receivedAt: now,
      stateStartedAt: now,
      payload: { state: 'working', prompt: '' }
    }
    expect(() => f.check([event], { ...policy, maxAccountWorkers: 1 })).toThrow('reserved')
    expect(() =>
      f.check([{ ...event, providerSessionOnly: true }], { ...policy, maxAccountWorkers: 1 })
    ).not.toThrow()
    expect(() =>
      f.check([{ ...event, payload: { ...event.payload, state: 'done' } }], {
        ...policy,
        maxAccountWorkers: 1
      })
    ).not.toThrow()
    expect(() =>
      f.check(
        [{ ...event, restoredUnconfirmed: true, payload: { ...event.payload, state: 'done' } }],
        { ...policy, maxAccountWorkers: 1 }
      )
    ).toThrow('reserved')
  })

  it('never releases malformed/unplaced worker reservations or accepts stale/contended resource readings', () => {
    const f = fixture()
    f.sample.observedAt = now - 30_001
    expect(f.check).toThrow('stale')
    f.sample.observedAt = now
    f.sample.host.loadAverage1m = 5
    expect(f.check).toThrow('contended')
    f.sample.host.loadAverage1m = 0.5
    const held = f.hold('ssh:second')
    f.db.db
      .prepare('UPDATE worker_dispatches SET start_options = ? WHERE dispatch_id = ?')
      .run('{broken', held.dispatch.id)
    expect(f.check).toThrow('unverifiable')
  })
})
