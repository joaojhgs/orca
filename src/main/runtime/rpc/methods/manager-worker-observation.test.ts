import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fixture,
  grant,
  runResult,
  workspaceId,
  cleanupManagerFixtures
} from './manager-work.test-support'

const observers = vi.hoisted(() => ({
  read: vi.fn(async () => ({
    source: 'transcript',
    cursor: 'opaque-next',
    status: { liveness: 'unverifiable' }
  })),
  show: vi.fn(async () => ({ observation: { status: 'unverifiable', exactWorker: true } }))
}))
vi.mock('./orchestration/worker/worker-control', () => ({
  ORCHESTRATION_WORKER_CONTROL_METHODS: [
    { name: 'orchestration.workerRead', handler: observers.read },
    { name: 'orchestration.workerShow', handler: observers.show }
  ]
}))
afterEach(() => {
  cleanupManagerFixtures()
  vi.clearAllMocks()
})

async function workerFixture(host = 'worker') {
  const f = fixture({ ...grant, actions: [...grant.actions, 'worker:read'] })
  const created = await f.runCreate()
  if (!created.ok) {
    throw new Error('create failed')
  }
  const runId = runResult.parse(created.result).run.id
  const started = f.db.createStartingWorkerDispatch({
    creator: { kind: 'system' },
    maxDepth: 2,
    taskSpec: 'Work',
    taskRunId: runId,
    startOptions: {}
  })
  f.db.prepareStartingWorkerAuthority({
    dispatchId: started.dispatch.id,
    handle: 'worker-terminal',
    paneKey: 'worker-pane',
    processIncarnation: 'incarnation',
    worktreeId: workspaceId,
    hostScope: JSON.stringify({ kind: 'ssh', targetId: host }),
    effects: [],
    setupState: 'not_applicable'
  })
  const params = { serviceToken: f.credential.token, runId, dispatchId: started.dispatch.id }
  return { ...f, params }
}

describe('manager worker observation', () => {
  it('reuses existing output cursors and preserves loss-of-contact as unverifiable', async () => {
    const f = await workerFixture()
    const result = await f.call('manager.workerRead', {
      ...f.params,
      cursor: 'opaque-before',
      limit: 20,
      source: 'transcript'
    })
    expect(result).toMatchObject({
      ok: true,
      result: { cursor: 'opaque-next', status: { liveness: 'unverifiable' } }
    })
    expect(observers.read).toHaveBeenCalledWith(
      { dispatch: f.params.dispatchId, cursor: 'opaque-before', limit: 20, source: 'transcript' },
      expect.anything()
    )
    expect(await f.call('manager.workerShow', f.params)).toMatchObject({
      ok: true,
      result: { observation: { status: 'unverifiable' } }
    })
  })

  it('refuses another execution host or wrong Run before touching worker output', async () => {
    const f = await workerFixture('unapproved-host')
    expect(await f.call('manager.workerRead', f.params)).toMatchObject({
      ok: false,
      error: { code: 'manager_forbidden' }
    })
    expect(observers.read).not.toHaveBeenCalled()
    const other = f.db.createRun({
      objective: 'User',
      coordinatorHandle: 'user',
      coordinatorPaneKey: 'pane'
    })
    expect(await f.call('manager.workerShow', { ...f.params, runId: other.id })).toMatchObject({
      ok: false,
      error: { code: 'manager_forbidden' }
    })
    expect(observers.show).not.toHaveBeenCalled()
  })

  it('rechecks credential and ownership after asynchronous worker reads', async () => {
    const f = await workerFixture()
    observers.read.mockImplementationOnce(async () => {
      f.db.managerPrincipals.revoke(f.credential.principal.id)
      return { source: 'transcript', cursor: 'opaque-next', status: { liveness: 'unverifiable' } }
    })
    expect(await f.call('manager.workerRead', f.params)).toMatchObject({
      ok: false,
      error: { code: 'manager_unauthorized' }
    })
  })

  it('enforces the page cap before any read', async () => {
    const f = await workerFixture()
    expect((await f.call('manager.workerRead', { ...f.params, limit: 201 })).ok).toBe(false)
    expect(observers.read).not.toHaveBeenCalled()
  })
})
