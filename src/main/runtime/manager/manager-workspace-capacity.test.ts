import { afterEach, describe, expect, it } from 'vitest'
import {
  fixture,
  runResult,
  cleanupManagerFixtures,
  workspaceId
} from '../rpc/methods/manager-work.test-support'
import { runLifecycleWriteTransaction } from '../orchestration/db/lifecycle-write-transaction-runner'
import { assertManagerWorkspaceCapacity } from './manager-workspace-capacity'
import type { WorkerDispatchState } from '../orchestration/types'

afterEach(cleanupManagerFixtures)

async function capacity() {
  const f = fixture()
  const created = await f.runCreate()
  if (!created.ok) {
    throw new Error('Run creation failed')
  }
  const runId = runResult.parse(created.result).run.id
  const check = (host = 'ssh:worker', workspace = workspaceId) =>
    runLifecycleWriteTransaction(f.db.db, 'capacity_check', () =>
      assertManagerWorkspaceCapacity(f.db, host, workspace)
    )
  const add = (
    options: {
      state?: WorkerDispatchState
      workspace?: string
      declaredHost?: string
      actualHost?: string
      malformed?: boolean
      unknownWorkspace?: boolean
      userOwned?: boolean
    } = {}
  ) => {
    const owner = options.userOwned
      ? f.db.createRun({
          objective: 'User task',
          coordinatorHandle: 'user-terminal',
          coordinatorPaneKey: 'user-pane'
        }).id
      : runId
    const task = f.db.createTask({ runId: owner, spec: 'Existing worker' })
    const scope = {
      executionHostId: options.declaredHost ?? 'ssh:worker',
      workspaceId: options.workspace ?? workspaceId,
      actor: 'root'
    }
    const started = f.db.createStartingWorkerDispatch({
      creator: { kind: 'system' },
      maxDepth: 2,
      taskId: task.id,
      startOptions: options.unknownWorkspace
        ? {}
        : { resolvedWorktreeId: scope.workspaceId, managerScope: scope }
    })
    if (options.state) {
      f.db.db
        .prepare('UPDATE worker_dispatches SET state = ? WHERE dispatch_id = ?')
        .run(options.state, started.dispatch.id)
    }
    if (options.actualHost) {
      f.db.db
        .prepare('UPDATE dispatch_contexts SET host_scope = ? WHERE id = ?')
        .run(JSON.stringify({ kind: 'ssh', targetId: options.actualHost }), started.dispatch.id)
    }
    if (options.malformed) {
      f.db.db
        .prepare('UPDATE worker_dispatches SET start_options = ? WHERE dispatch_id = ?')
        .run('{broken', started.dispatch.id)
    }
    return started
  }
  return { ...f, runId, check, add }
}

describe('manager workspace acceptance capacity', () => {
  it('requires the same SQL acceptance transaction rather than a detached availability check', async () => {
    const f = await capacity()
    expect(() => assertManagerWorkspaceCapacity(f.db, 'ssh:worker', workspaceId)).toThrow(
      'acceptance transaction'
    )
    expect(f.check).not.toThrow()
  })

  it.each(['starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown'] as const)(
    'reserves a workspace while its worker is %s',
    async (state) => {
      const f = await capacity()
      const worker = f.add({ state })
      const before = f.db.getWorkerDispatch(worker.dispatch.id)
      expect(f.check).toThrow('occupied or unverifiable')
      expect(f.db.getWorkerDispatch(worker.dispatch.id)).toEqual(before)
      expect(f.db.getTask(worker.task.id)?.status).toBe('dispatched')
    }
  )

  it.each(['succeeded', 'failed', 'stopped', 'abandoned'] as const)(
    'releases custody only after explicit %s settlement',
    async (state) => {
      const f = await capacity()
      f.add({ state })
      expect(f.check).not.toThrow()
    }
  )

  it('protects existing user-owned supervised work without adopting or mutating it', async () => {
    const f = await capacity()
    const worker = f.add({ userOwned: true })
    expect(f.check).toThrow('occupied or unverifiable')
    expect(f.db.getRun(worker.task.run_id)?.coordinator_handle).toBe('user-terminal')
    expect(
      f.db.db
        .prepare('SELECT run_id FROM manager_run_ownership WHERE run_id = ?')
        .get(worker.task.run_id)
    ).toBeUndefined()
  })

  it('lets independent workspaces progress on the same host', async () => {
    const f = await capacity()
    f.add({ workspace: 'repo::/repo/other' })
    expect(f.check).not.toThrow()
  })

  it('keeps equal workspace labels on explicitly distinct hosts independent', async () => {
    const f = await capacity()
    f.add({ declaredHost: 'ssh:notebook', actualHost: 'notebook' })
    expect(f.check).not.toThrow()
    expect(() => f.check('ssh:notebook')).toThrow('occupied or unverifiable')
  })

  it('uses the frozen approved placement before provider binding has filled host/workspace columns', async () => {
    const f = await capacity()
    const worker = f.add()
    expect(f.db.getWorkerDispatch(worker.dispatch.id)?.worktree_id).toBeNull()
    expect(f.db.getDispatchContextById(worker.dispatch.id)?.host_scope).toBeNull()
    expect(f.check).toThrow('occupied or unverifiable')
  })

  it('does not treat a failed Dispatch projection as proof an unknown worker exited', async () => {
    const f = await capacity()
    const worker = f.add({ state: 'stop_unknown' })
    f.db.db
      .prepare("UPDATE dispatch_contexts SET status = 'failed' WHERE id = ?")
      .run(worker.dispatch.id)
    expect(f.check).toThrow('occupied or unverifiable')
  })

  it('fails closed for unreadable or unresolved active placements', async () => {
    for (const options of [{ malformed: true }, { unknownWorkspace: true }]) {
      const f = await capacity()
      f.add(options)
      expect(f.check).toThrow('occupied or unverifiable')
    }
  })

  it('does not leak a contradictory host reservation into an unrelated host', async () => {
    const f = await capacity()
    f.add({ actualHost: 'notebook' })
    expect(f.check).toThrow('occupied or unverifiable')
    expect(() => f.check('ssh:notebook')).toThrow('occupied or unverifiable')
    expect(() => f.check('ssh:other')).not.toThrow()
  })

  it('does not interpret contradictory canonical workspace identities as free capacity', async () => {
    const f = await capacity()
    const worker = f.add()
    f.db.db
      .prepare('UPDATE worker_dispatches SET worktree_id = ? WHERE dispatch_id = ?')
      .run('repo::/repo/other', worker.dispatch.id)
    expect(f.check).toThrow('occupied or unverifiable')
    expect(() => f.check('ssh:worker', 'repo::/repo/other')).toThrow('occupied or unverifiable')
  })

  it('admits only one acceptance when two launches attempt the same workspace', async () => {
    const f = await capacity()
    const accept = () =>
      runLifecycleWriteTransaction(f.db.db, 'simultaneous_accept', () => {
        assertManagerWorkspaceCapacity(f.db, 'ssh:worker', workspaceId)
        return f.add()
      })
    accept()
    expect(accept).toThrow('occupied or unverifiable')
    expect(
      f.db.db.prepare("SELECT dispatch_id FROM worker_dispatches WHERE state = 'starting'").all()
    ).toHaveLength(1)
  })
})
