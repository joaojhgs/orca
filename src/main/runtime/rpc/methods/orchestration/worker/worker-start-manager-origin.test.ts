import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOrchestrationWorkerReleaseHarness } from './worker-release.test-support'
import { startLocalWorker } from './local-worker-start'
import { decideWorkerStartMode } from '../../orchestration-worker-start-mode'
import { ManagerAuthorityError } from '../../../../manager/manager-authority-error'

const h = createOrchestrationWorkerReleaseHarness()
beforeEach(() => h.setup())
afterEach(() => h.cleanup())

function startFixture() {
  const scope = {
    executionHostId: 'local',
    projectId: 'project',
    workspaceId: 'repo::worktree',
    actor: 'root' as const
  }
  const grant = { executionHostIds: ['local'], projectIds: ['project'], runIds: [] }
  const credential = h.db.managerPrincipals.issue(
    'Manager',
    { scope: grant, actions: ['worker:start', 'events:read'] },
    Date.now() + 60_000
  )
  const run = h.db.createRun({
    objective: 'Service-owned work',
    coordinatorHandle: null,
    coordinatorPaneKey: null
  })
  h.db.managerRuns.registerCreatedRun(credential.principal.id, run, scope)
  const task = h.db.createTask({ runId: run.id, spec: 'Perform bounded work' })
  const params = {
    from: `run:${run.id}`,
    worktree: 'id:repo::worktree',
    agent: 'codex' as const,
    task: task.id
  }
  const serviceOrigin = {
    workspaceId: scope.workspaceId,
    scope,
    assertAuthority: vi.fn(() => {
      h.db.managerPrincipals.authorize(credential.principal.id, 'worker:start')
    }),
    assertPlacement: vi.fn(),
    acceptDispatch: (operation: () => ReturnType<typeof h.db.createStartingWorkerDispatch>) =>
      operation()
  }
  const start = () =>
    startLocalWorker({
      params,
      runtime: h.runtime,
      db: h.db,
      run,
      coordinator: null,
      existingTask: task,
      serviceOrigin,
      mode: decideWorkerStartMode({ params, settings: null })
    })
  const events = () =>
    h.db.managerEvents.read(h.db.managerRuns.observationGrant(credential.principal.id, grant))
      .events
  return { credential, run, task, scope, serviceOrigin, start, events }
}

describe('real worker launch from a manager service origin', () => {
  it('persists the service scope through terminal placement and emits completion once', async () => {
    const f = startFixture()
    const result = await f.start()
    expect(result).toMatchObject({ state: 'ready', taskId: f.task.id })
    const context = h.db.getDispatchContext(f.task.id)
    const dispatch = context && h.db.getWorkerDispatch(context.id)
    if (!dispatch) {
      throw new Error('Worker dispatch missing')
    }
    expect(JSON.parse(dispatch.start_options)).toMatchObject({ managerScope: f.scope })
    expect(f.serviceOrigin.assertPlacement).toHaveBeenCalledWith(dispatch.dispatch_id)
    expect(h.runtime.sendTerminalAgentPrompt).toHaveBeenCalled()
    h.db.createQuestion({
      runId: f.run.id,
      dispatchId: dispatch.dispatch_id,
      askerHandle: 'term_worker',
      question: 'Which branch?'
    })
    h.db.settleWorkerReport({
      taskId: f.task.id,
      dispatchId: dispatch.dispatch_id,
      outcome: 'succeeded',
      result: 'Verified result'
    })
    expect(f.events()).toMatchObject([
      { kind: 'question', scope: { workspaceId: f.scope.workspaceId } },
      { kind: 'dispatch-settled', outcome: 'succeeded' }
    ])
    h.db.settleWorkerReport({
      taskId: f.task.id,
      dispatchId: dispatch.dispatch_id,
      outcome: 'succeeded',
      result: 'Verified result'
    })
    expect(f.events()).toHaveLength(2)
  })

  it('keeps a launched terminal alive if service authority is revoked during readiness', async () => {
    const f = startFixture()
    vi.spyOn(h.runtime, 'waitForTerminal').mockImplementationOnce(async () => {
      h.db.managerPrincipals.revoke(f.credential.principal.id)
      return {
        handle: 'term_worker',
        condition: 'tui-idle',
        satisfied: true,
        status: 'running',
        exitCode: null
      }
    })
    await expect(f.start()).rejects.toBeInstanceOf(ManagerAuthorityError)
    expect(h.runtime.closeTerminal).not.toHaveBeenCalled()
    expect(h.runtime.sendTerminalAgentPrompt).not.toHaveBeenCalled()
    const context = h.db.getDispatchContext(f.task.id)
    expect(context && h.db.getWorkerDispatch(context.id)?.state).toBe('start_unknown')
    expect(f.events()).toHaveLength(0)
  })
})
