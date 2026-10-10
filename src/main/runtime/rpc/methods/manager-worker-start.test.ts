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

const launch = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('./orchestration/worker/local-worker-start', () => ({ startLocalWorker: launch.start }))
afterEach(() => {
  cleanupManagerFixtures()
  vi.resetAllMocks()
})

async function startFixture() {
  const f = fixture({ ...grant, actions: [...grant.actions, 'worker:start'], maxActiveWorkers: 1 })
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
    effort: 'high'
  }
  launch.start.mockImplementation(async (args: Parameters<typeof startLocalWorker>[0]) => {
    if (!args.serviceOrigin) {
      throw new Error('Missing service origin')
    }
    const started = args.serviceOrigin.acceptDispatch(() =>
      args.db.createStartingWorkerDispatch({
        creator: { kind: 'system' },
        maxDepth: 2,
        taskId: args.existingTask?.id,
        startOptions: { workspaceId },
        mutationReceipt: args.orchestrationMutation
      })
    )
    return { runId, taskId: started.task.id, dispatchId: started.dispatch.id, state: 'ready' }
  })
  return { ...f, params }
}

describe('scoped manager worker start', () => {
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
