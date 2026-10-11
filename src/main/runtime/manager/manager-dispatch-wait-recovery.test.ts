import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fixture,
  grant,
  runResult,
  workspaceId,
  cleanupManagerFixtures
} from '../rpc/methods/manager-work.test-support'
import { agentHookServer } from '../../agent-hooks/server'
import {
  cleanupDispatchReadings,
  dispatchHost,
  installDispatchReadings
} from './manager-dispatch.test-fixture'
import {
  queueManagerDispatchWait,
  assertManagerDispatchWaitInput
} from './manager-dispatch-wait-store'
import { recoverManagerDispatchWaits } from './manager-dispatch-wait-recovery'

afterEach(() => {
  cleanupDispatchReadings()
  cleanupManagerFixtures()
})

async function waitingFixture() {
  const f = fixture({ ...grant, actions: [...grant.actions, 'worker:start'] })
  const readings = installDispatchReadings(f.runtime)
  vi.spyOn(agentHookServer, 'getEnrichedStatusSnapshot').mockReturnValue([])
  const result = await f.runCreate()
  if (!result.ok) {
    throw new Error('No Run')
  }
  const runId = runResult.parse(result.result).run.id
  const task = f.db.createTask({ runId, spec: 'Bounded work' })
  const target = {
    runId,
    taskId: task.id,
    workspaceId,
    agent: 'codex',
    workClass: 'build' as const
  }
  const enqueue = () =>
    queueManagerDispatchWait(
      f.db,
      f.credential.principal.id,
      'request',
      'hash',
      'ssh:worker',
      target
    )
  enqueue()
  const sample = vi.fn(async () => ({
    executionHostId: 'ssh:worker',
    observedAt: Date.now(),
    host: { ...dispatchHost }
  }))
  const rows = () => f.db.db.prepare('SELECT * FROM manager_dispatch_waits').all()
  const events = () =>
    f.db.managerEvents.read(
      f.db.managerRuns.observationGrant(f.credential.principal.id, grant.scope)
    ).events
  return { ...f, readings, target, enqueue, sample, rows, events }
}

describe('durable capacity recovery wakes', () => {
  it('holds blocked capacity, emits one recovery event, and never launches a worker', async () => {
    const f = await waitingFixture()
    f.sample.mockResolvedValueOnce({
      executionHostId: 'ssh:worker',
      observedAt: Date.now(),
      host: { ...dispatchHost, availableMemory: 0 }
    })
    await recoverManagerDispatchWaits(f.runtime, f.sample)
    expect(f.rows()).toMatchObject([{ state: 'waiting' }])
    expect(f.events()).toHaveLength(0)
    await recoverManagerDispatchWaits(f.runtime, f.sample)
    expect(f.rows()).toMatchObject([{ state: 'notified' }])
    expect(f.events()).toMatchObject([
      {
        source: 'manager-capacity',
        kind: 'progress',
        scope: { runId: f.target.runId, actor: 'root' }
      }
    ])
    await recoverManagerDispatchWaits(f.runtime, f.sample)
    expect(f.events()).toHaveLength(1)
    expect(f.sample).toHaveBeenCalledTimes(2)
    expect(f.db.db.prepare('SELECT * FROM worker_dispatches').all()).toHaveLength(0)
  })

  it('keeps stale/shared-account quota pending and re-arms only after a fresh refused attempt', async () => {
    const f = await waitingFixture()
    f.readings.account.checkedAt = Date.now() - 300_001
    await recoverManagerDispatchWaits(f.runtime, f.sample)
    expect(f.events()).toHaveLength(0)
    f.readings.account.checkedAt = Date.now()
    await recoverManagerDispatchWaits(f.runtime, f.sample)
    f.enqueue()
    await recoverManagerDispatchWaits(f.runtime, f.sample)
    expect(f.events()).toHaveLength(2)
    expect(new Set(f.events().map((e) => e.eventId)).size).toBe(2)
    expect(() =>
      assertManagerDispatchWaitInput(f.db, f.credential.principal.id, 'request', 'changed')
    ).toThrow('cannot change')
  })

  it.each(['revoked', 'takeover', 'dispatched'] as const)(
    'retires %s waits without borrowing authority or waking the manager',
    async (mode) => {
      const f = await waitingFixture()
      if (mode === 'revoked') {
        f.db.managerPrincipals.revoke(f.credential.principal.id)
      }
      if (mode === 'takeover') {
        f.db.db
          .prepare('UPDATE runs SET consumer_generation = consumer_generation + 1 WHERE id = ?')
          .run(f.target.runId)
      }
      if (mode === 'dispatched') {
        f.db.createStartingWorkerDispatch({
          taskId: f.target.taskId,
          creator: { kind: 'system' },
          maxDepth: 2,
          startOptions: {}
        })
      }
      await recoverManagerDispatchWaits(f.runtime, f.sample)
      expect(f.rows()).toHaveLength(0)
      expect(f.sample).not.toHaveBeenCalled()
      expect(f.events()).toHaveLength(0)
    }
  )

  it('has no host/model polling without waits and cannot emit after shutdown during an observation', async () => {
    const f = await waitingFixture()
    let stopped = false
    f.sample.mockImplementationOnce(async () => {
      stopped = true
      return { executionHostId: 'ssh:worker', observedAt: Date.now(), host: { ...dispatchHost } }
    })
    await recoverManagerDispatchWaits(f.runtime, f.sample, () => stopped)
    expect(f.events()).toHaveLength(0)
    expect(f.rows()).toMatchObject([{ state: 'waiting' }])
    f.db.db.prepare('DELETE FROM manager_dispatch_waits').run()
    f.sample.mockClear()
    await recoverManagerDispatchWaits(f.runtime, f.sample)
    expect(f.sample).not.toHaveBeenCalled()
  })
})
