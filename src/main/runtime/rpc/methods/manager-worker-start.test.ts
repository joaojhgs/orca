import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fixture,
  grant,
  runResult,
  workspaceId,
  cleanupManagerFixtures
} from './manager-work.test-support'
import type { startLocalWorker } from './orchestration/worker/local-worker-start'
import { buildDispatchPreamble } from '../../orchestration/preamble'
import { agentHookServer } from '../../../agent-hooks/server'
import {
  installDispatchReadings,
  cleanupDispatchReadings
} from '../../manager/manager-dispatch.test-fixture'

const launch = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('./orchestration/worker/local-worker-start', () => ({ startLocalWorker: launch.start }))
afterEach(() => {
  cleanupManagerFixtures()
  cleanupDispatchReadings()
  vi.resetAllMocks()
})

async function startFixture(maxActiveWorkers = 1) {
  vi.spyOn(agentHookServer, 'getEnrichedStatusSnapshot').mockReturnValue([])
  const f = fixture({ ...grant, actions: [...grant.actions, 'worker:start'], maxActiveWorkers })
  const readings = installDispatchReadings(f.runtime)
  const created = await f.runCreate()
  if (!created.ok) {
    throw new Error('Run creation failed')
  }
  const runId = runResult.parse(created.result).run.id
  const task = f.db.createTask({ runId, spec: 'Do bounded work' })
  const params = {
    serviceToken: f.credential.token,
    lease: f.lease,
    requestId: 'launch-one',
    runId,
    taskId: task.id,
    workspaceId,
    agent: 'codex',
    model: 'gpt-6.1-sol',
    effort: 'high',
    workClass: 'edit'
  }
  launch.start.mockImplementation(async (args: Parameters<typeof startLocalWorker>[0]) => {
    const origin = args.serviceOrigin
    if (!origin) {
      throw new Error('Missing service origin')
    }
    const started = origin.acceptDispatch(() =>
      args.db.createStartingWorkerDispatch({
        creator: { kind: 'system' },
        maxDepth: 2,
        taskId: args.existingTask?.id,
        startOptions: {
          resolvedWorktreeId: origin.workspaceId,
          managerScope: origin.scope
        },
        mutationReceipt: args.orchestrationMutation,
        retryOf: args.params.retryOf
      })
    )
    return { runId, taskId: started.task.id, dispatchId: started.dispatch.id, state: 'ready' }
  })
  return { ...f, params, readings }
}

describe('scoped manager worker start', () => {
  it('retries a settled failed attempt on the same Task, including receipt replay', async () => {
    const f = await startFixture()
    const prior = f.db.createStartingWorkerDispatch({
      creator: { kind: 'system' },
      maxDepth: 2,
      taskId: f.params.taskId,
      startOptions: {}
    })
    f.db.failWorkerStart(prior.dispatch.id, 'agent_readiness', 'Update menu')
    const params = { ...f.params, retryOf: prior.dispatch.id }
    const result = await f.call('manager.workerStart', params)
    expect(result).toMatchObject({ ok: true, result: { taskId: f.params.taskId, state: 'ready' } })
    expect(f.db.getDispatchContext(f.params.taskId)?.retry_of_dispatch_id).toBe(prior.dispatch.id)
    expect(f.db.listTasks({ runId: f.params.runId })).toHaveLength(1)
    expect(await f.call('manager.workerStart', params)).toEqual(result)
    expect(launch.start).toHaveBeenCalledTimes(1)
  })

  it.each(['unknown', 'wrong-task', 'superseded'] as const)(
    'refuses a retry of an %s attempt without accepting another Dispatch',
    async (mode) => {
      const f = await startFixture()
      const prior = f.db.createStartingWorkerDispatch({
        creator: { kind: 'system' },
        maxDepth: 2,
        taskId: f.params.taskId,
        startOptions: {}
      })
      if (mode === 'unknown') {
        f.db.markWorkerStartUnknown(prior.dispatch.id, 'input', 'Contact lost')
      } else {
        f.db.failWorkerStart(prior.dispatch.id, 'agent_readiness', 'Update menu')
      }
      let retryOf = prior.dispatch.id
      if (mode === 'wrong-task') {
        const otherTask = f.db.createTask({ runId: f.params.runId, spec: 'Other' })
        const other = f.db.createStartingWorkerDispatch({
          creator: { kind: 'system' },
          maxDepth: 2,
          taskId: otherTask.id,
          startOptions: {}
        })
        f.db.failWorkerStart(other.dispatch.id, 'agent_readiness', 'Other failure')
        retryOf = other.dispatch.id
      }
      if (mode === 'superseded') {
        const newer = f.db.createStartingWorkerDispatch({
          creator: { kind: 'system' },
          maxDepth: 2,
          taskId: f.params.taskId,
          startOptions: {},
          retryOf
        })
        f.db.failWorkerStart(newer.dispatch.id, 'agent_readiness', 'Newer failure')
      }
      const count = f.db.db.prepare('SELECT dispatch_id FROM worker_dispatches').all().length
      expect(await f.call('manager.workerStart', { ...f.params, retryOf })).toMatchObject({
        ok: false,
        error: { code: 'manager_forbidden' }
      })
      expect(f.db.db.prepare('SELECT dispatch_id FROM worker_dispatches').all()).toHaveLength(count)
      expect(
        f.db.getMutationReceipt(`manager:${f.credential.principal.id}`, f.params.requestId)
      ).toBeUndefined()
    }
  )

  it('keeps a failed-Task retry waiting for capacity with its prior attempt identity intact', async () => {
    const f = await startFixture()
    const prior = f.db.createStartingWorkerDispatch({
      creator: { kind: 'system' },
      maxDepth: 2,
      taskId: f.params.taskId,
      startOptions: {}
    })
    f.db.failWorkerStart(prior.dispatch.id, 'agent_readiness', 'Update menu')
    const params = { ...f.params, retryOf: prior.dispatch.id }
    f.readings.account.checkedAt = Date.now() - 300_001
    expect(await f.call('manager.workerStart', params)).toMatchObject({ ok: false })
    const row = f.db.db.prepare('SELECT target_json FROM manager_dispatch_waits').get()
    expect(row).toMatchObject({ target_json: expect.stringContaining(prior.dispatch.id) })
    expect(f.db.getTask(f.params.taskId)?.status).toBe('failed')
    f.readings.account.checkedAt = Date.now()
    expect(await f.call('manager.workerStart', params)).toMatchObject({ ok: true })
    expect(f.db.db.prepare('SELECT * FROM manager_dispatch_waits').all()).toHaveLength(0)
  })

  it('reuses worker launch without borrowing a terminal, and replays one durable request', async () => {
    const f = await startFixture()
    const result = await f.call('manager.workerStart', f.params)
    expect(result).toMatchObject({ ok: true, result: { state: 'ready', runId: f.params.runId } })
    expect(launch.start).toHaveBeenCalledWith(
      expect.objectContaining({
        coordinator: null,
        serviceOrigin: expect.objectContaining({
          scope: expect.objectContaining({ executionHostId: 'ssh:worker', workspaceId })
        }),
        params: expect.objectContaining({
          from: `run:${f.params.runId}`,
          worktree: `id:${workspaceId}`,
          model: 'gpt-6.1-sol',
          effort: 'high'
        })
      })
    )
    expect(await f.call('manager.workerStart', f.params)).toEqual(result)
    expect(launch.start).toHaveBeenCalledTimes(1)
    expect(await f.call('manager.workerStart', { ...f.params, model: 'another' })).toMatchObject({
      ok: false,
      error: { code: 'request_mismatch' }
    })
  })

  it('keeps a pending acceptance after disconnect and never launches it twice', async () => {
    const f = await startFixture()
    const operation = launch.start.getMockImplementation()
    if (!operation) {
      throw new Error('Missing launch fixture')
    }
    launch.start.mockImplementationOnce(async (...args) => {
      await operation(...args)
      throw new Error('Transport disconnected after acceptance')
    })
    expect((await f.call('manager.workerStart', f.params)).ok).toBe(false)
    expect(await f.call('manager.workerStart', f.params)).toMatchObject({
      ok: true,
      result: { state: 'outcome_unknown', reconciliationRequired: true }
    })
    expect(launch.start).toHaveBeenCalledTimes(1)
  })

  it('counts unconfirmed starts against the cap atomically across owned Runs', async () => {
    const f = await startFixture()
    expect((await f.call('manager.workerStart', f.params)).ok).toBe(true)
    const created = await f.runCreate({ requestId: 'another-run' })
    if (!created.ok) {
      throw new Error('Second Run creation failed')
    }
    const runId = runResult.parse(created.result).run.id
    const another = f.db.createTask({ runId, spec: 'Another task' })
    expect(
      await f.call('manager.workerStart', {
        ...f.params,
        runId,
        taskId: another.id,
        requestId: 'two'
      })
    ).toMatchObject({
      ok: false,
      error: { code: 'manager_forbidden' }
    })
    expect(f.db.getTask(another.id)?.status).toBe('ready')
    expect(f.db.getMutationReceipt(`manager:${f.credential.principal.id}`, 'two')).toBeUndefined()
  })

  it('refuses a second writer in the same workspace even while the principal has spare worker capacity', async () => {
    const f = await startFixture(2)
    expect((await f.call('manager.workerStart', f.params)).ok).toBe(true)
    const task = f.db.createTask({ runId: f.params.runId, spec: 'Conflicting writer' })
    expect(
      await f.call('manager.workerStart', { ...f.params, taskId: task.id, requestId: 'conflict' })
    ).toMatchObject({
      ok: false,
      error: {
        code: 'manager_forbidden',
        message: expect.stringContaining('occupied or unverifiable')
      }
    })
    expect(f.db.getTask(task.id)?.status).toBe('ready')
    expect(
      f.db.getMutationReceipt(`manager:${f.credential.principal.id}`, 'conflict')
    ).toBeUndefined()
    expect(f.db.db.prepare('SELECT dispatch_id FROM worker_dispatches').all()).toHaveLength(1)
  })

  it('keeps separate workspaces eligible for parallel work within the principal cap', async () => {
    const f = await startFixture(2)
    expect((await f.call('manager.workerStart', f.params)).ok).toBe(true)
    const target = 'repo::/repo/independent'
    const task = f.db.createTask({ runId: f.params.runId, spec: 'Independent writer' })
    vi.mocked(f.runtime.showTerminalWorkspaceLaunchScope).mockResolvedValueOnce({
      id: target,
      path: '/repo/independent',
      connectionId: 'worker',
      repo: null,
      folderWorkspace: null
    })
    expect(
      await f.call('manager.workerStart', {
        ...f.params,
        taskId: task.id,
        workspaceId: target,
        requestId: 'independent'
      })
    ).toMatchObject({
      ok: true,
      result: { state: 'ready' }
    })
    expect(f.db.db.prepare('SELECT dispatch_id FROM worker_dispatches').all()).toHaveLength(2)
  })

  it('refuses to launch beside a user agent that has no supervised Dispatch', async () => {
    const f = await startFixture(2)
    vi.mocked(agentHookServer.getEnrichedStatusSnapshot).mockReturnValue([
      {
        paneKey: 'existing-user-session',
        connectionId: 'worker',
        worktreeId: workspaceId,
        receivedAt: 10,
        stateStartedAt: 1,
        payload: { state: 'working', prompt: 'Private user task' }
      }
    ])
    expect(await f.call('manager.workerStart', f.params)).toMatchObject({
      ok: false,
      error: { code: 'manager_forbidden', message: expect.stringContaining('agent session') }
    })
    expect(f.db.db.prepare('SELECT dispatch_id FROM worker_dispatches').all()).toHaveLength(0)
    expect(f.db.getTask(f.params.taskId)?.status).toBe('ready')
    expect(
      f.db.getMutationReceipt(`manager:${f.credential.principal.id}`, f.params.requestId)
    ).toBeUndefined()
  })

  it('refuses user-owned tasks, host substitution, aliases and raw terminal claims', async () => {
    const f = await startFixture()
    const userRun = f.db.createRun({
      objective: 'User',
      coordinatorHandle: 'user',
      coordinatorPaneKey: 'pane'
    })
    const userTask = f.db.createTask({ runId: userRun.id, spec: 'Private work' })
    expect(await f.call('manager.workerStart', { ...f.params, taskId: userTask.id })).toMatchObject(
      {
        ok: false,
        error: { code: 'manager_forbidden' }
      }
    )
    expect((await f.call('manager.workerStart', { ...f.params, terminal: 'user' })).ok).toBe(false)
    expect((await f.call('manager.workerStart', { ...f.params, agent: 'shell-alias' })).ok).toBe(
      false
    )
    vi.spyOn(f.runtime, 'showTerminalWorkspaceLaunchScope').mockResolvedValueOnce({
      id: workspaceId,
      path: '/repo',
      connectionId: 'another-host',
      repo: null,
      folderWorkspace: null
    })
    expect(await f.call('manager.workerStart', f.params)).toMatchObject({
      ok: false,
      error: { code: 'manager_forbidden' }
    })
    expect(launch.start).not.toHaveBeenCalled()
  })

  it('fences revocation during preflight before starting anything', async () => {
    const f = await startFixture()
    vi.spyOn(f.runtime, 'showTerminalWorkspaceLaunchScope').mockImplementationOnce(async () => {
      f.db.managerPrincipals.revoke(f.credential.principal.id)
      return {
        id: workspaceId,
        path: '/repo',
        connectionId: 'worker',
        repo: null,
        folderWorkspace: null
      }
    })
    expect(await f.call('manager.workerStart', f.params)).toMatchObject({
      ok: false,
      error: { code: 'manager_unauthorized' }
    })
    expect(launch.start).not.toHaveBeenCalled()
  })

  it('persists a refused quota attempt, then clears its wait only with atomic worker acceptance', async () => {
    const f = await startFixture()
    f.readings.account.checkedAt = Date.now() - 300_001
    expect(await f.call('manager.workerStart', f.params)).toMatchObject({
      ok: false,
      error: { code: 'manager_forbidden' }
    })
    expect(f.db.db.prepare('SELECT * FROM manager_dispatch_waits').all()).toHaveLength(1)
    expect(f.db.db.prepare('SELECT * FROM worker_dispatches').all()).toHaveLength(0)
    f.readings.account.checkedAt = Date.now()
    expect(await f.call('manager.workerStart', f.params)).toMatchObject({
      ok: true,
      result: { state: 'ready' }
    })
    expect(f.db.db.prepare('SELECT * FROM manager_dispatch_waits').all()).toHaveLength(0)
    f.readings.account.checkedAt = 0
    f.readings.collect.mockRejectedValue(new Error('Host disconnected'))
    const calls = f.readings.collect.mock.calls.length
    expect(await f.call('manager.workerStart', f.params)).toMatchObject({
      ok: true,
      result: { state: 'ready' }
    })
    expect(f.readings.collect.mock.calls).toHaveLength(calls)
    expect(f.db.db.prepare('SELECT * FROM worker_dispatches').all()).toHaveLength(1)
  })

  it('does not queue a permanent edit-class attempt to bypass requested test capacity', async () => {
    const f = await startFixture()
    const task = f.db.createTask({
      runId: f.params.runId,
      spec: 'Test changes',
      completionRequirements: { role: 'work', tests: ['pnpm test'] }
    })
    expect(await f.call('manager.workerStart', { ...f.params, taskId: task.id })).toMatchObject({
      ok: false,
      error: {
        code: 'manager_forbidden',
        message: expect.stringContaining('reserve build capacity')
      }
    })
    expect(f.db.db.prepare('SELECT * FROM manager_dispatch_waits').all()).toHaveLength(0)
    expect(f.db.db.prepare('SELECT * FROM worker_dispatches').all()).toHaveLength(0)
  })

  it('names the Run mailbox honestly in worker instructions', () => {
    const preamble = buildDispatchPreamble({
      coordinatorHandle: 'run:owned',
      workerHandle: 'term_worker',
      taskId: 'task',
      dispatchId: 'dispatch',
      taskSpec: 'Work'
    })
    expect(preamble).toContain("coordinator's durable Run mailbox is: run:owned")
    expect(preamble).not.toContain("coordinator's terminal handle is: run:owned")
    expect(preamble).toContain('orchestration ask --from term_worker')
  })
})
