import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { fixture, grant, runResult, cleanupManagerFixtures } from './manager-work.test-support'
import { createRootDispatch } from '../../orchestration/db/root-dispatch-test-fixture'
import { workerReportObservation } from '../../orchestration/worker-report-observation'
import { managerCompletionMessage } from '../../manager/manager-completion-evidence'
import { appendManagerConversation } from '../../manager/manager-conversation-messages'
import { deliverPendingManagerQuestions } from '../../manager/manager-question-notifications'
import { confirmNotificationDigestRelevance } from '../../../notifications/notification-digest-relevance'
import type { MobileNotificationEvent } from '../../runtime-mobile-notification-controller'
import type { ManagerTaskRequirements } from '../../../../shared/manager-completion-contract'

afterEach(cleanupManagerFixtures)
const taskResponse = z.object({ task: z.object({ id: z.string() }) })

async function setup() {
  const f = fixture({ ...grant, actions: [...grant.actions, 'conversation:write'] })
  const created = await f.runCreate()
  if (!created.ok) {
    throw new Error('Run not created')
  }
  const runId = runResult.parse(created.result).run.id
  let request = 0
  const task = async (
    requirements: ManagerTaskRequirements = {
      role: 'work',
      tests: ['npm test'],
      gitBranch: 'feature'
    }
  ) => {
    const result = await f.call('manager.taskCreate', {
      serviceToken: f.credential.token,
      lease: f.lease,
      runId,
      requestId: `task-${++request}`,
      spec: 'Bounded task',
      completionRequirements: requirements
    })
    if (!result.ok) {
      throw new Error(JSON.stringify(result))
    }
    return taskResponse.parse(result.result).task.id
  }
  const report = (taskId: string, body: string, assigneeHandle = `terminal-${taskId}`) => {
    const dispatch = createRootDispatch(f.db, taskId, assigneeHandle)
    f.db.db
      .prepare("UPDATE dispatch_contexts SET status = 'dispatched' WHERE id = ?")
      .run(dispatch.id)
    const message = f.db.insertMessage({
      runId,
      from: assigneeHandle,
      to: `run:${runId}`,
      type: 'worker_done',
      subject: 'Worker result',
      body
    })
    const observation = workerReportObservation(message)
    expect(
      f.db.settleWorkerReport({
        taskId,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        result: body,
        observation
      })
    ).toMatchObject({ action: 'settled' })
    return { taskId, dispatchId: dispatch.id, reportId: observation.id }
  }
  const workTaskId = await task()
  const work = report(workTaskId, 'Implementation completed')
  const verificationBody = {
    version: 1,
    verifiedTaskId: work.taskId,
    verifiedDispatchId: work.dispatchId,
    verifiedReportId: work.reportId,
    summary: 'Independently checked results',
    tests: [{ command: 'npm test', exitCode: 0, output: '12 tests passed' }],
    git: { branch: 'feature', commit: 'a'.repeat(40), clean: true }
  }
  const verify = async (body: unknown = verificationBody, handle?: string) => {
    const id = await task({ role: 'verification', verifiesTaskId: workTaskId })
    return report(id, typeof body === 'string' ? body : JSON.stringify(body), handle)
  }
  const post = (evidence: unknown, overrides: Record<string, unknown> = {}) =>
    f.call('manager.conversationPost', {
      runId,
      serviceToken: f.credential.token,
      lease: f.lease,
      requestId: 'complete',
      kind: 'reply',
      body: 'Objective completed with independent verification',
      completionEvidence: evidence,
      ...overrides
    })
  return { ...f, runId, task, report, work, verify, post, verificationBody }
}

describe('manager objective completion evidence', () => {
  it('stores one result and root alert atomically, with exact replay and no self-wake', async () => {
    const f = await setup()
    const verifier = await f.verify()
    const events: MobileNotificationEvent[] = []
    f.runtime.onNotificationDispatched((event) => {
      expect(f.db.db.isTransaction).toBe(false)
      events.push(event)
    })
    const before = f.db.managerEvents.read({ ...grant.scope, runIds: [f.runId] }).events.length
    const first = await f.post([f.work, verifier])
    expect(first).toMatchObject({
      ok: true,
      result: { message: { kind: 'reply', completion: { evidence: [f.work, verifier] } } }
    })
    expect(await f.post([f.work, verifier])).toEqual(first)
    deliverPendingManagerQuestions(f.runtime)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      notificationKind: 'completion',
      notificationScope: { actor: 'manager', sessionId: f.runId }
    })
    expect(JSON.stringify(events)).not.toContain('12 tests passed')
    expect(await confirmNotificationDigestRelevance(f.runtime, events[0])).toBe(true)
    expect(f.db.managerEvents.read({ ...grant.scope, runIds: [f.runId] }).events).toHaveLength(
      before
    )
    const read = await f.call('manager.conversationRead', {
      runId: f.runId,
      serviceToken: f.credential.token
    })
    expect(read).toMatchObject({
      ok: true,
      result: { messages: [{ completion: { evidence: [f.work, verifier] } }] }
    })
    expect((await f.post([f.work, verifier], { requestId: 'other-result' })).ok).toBe(false)
    expect(
      f.db.db.prepare('SELECT message_id FROM manager_objective_completions').all()
    ).toHaveLength(1)
  })

  it.each(['missing', 'duplicate', 'foreign', 'stale', 'unreported'] as const)(
    'refuses %s Task/report coverage without a receipt or alert',
    async (mode) => {
      const f = await setup()
      const verifier = await f.verify()
      let evidence = [f.work, verifier]
      if (mode === 'missing') {
        evidence = [f.work]
      }
      if (mode === 'duplicate') {
        evidence = [f.work, f.work]
      }
      if (mode === 'foreign') {
        evidence = [f.work, { ...verifier, taskId: 'foreign' }]
      }
      if (mode === 'stale') {
        evidence = [{ ...f.work, reportId: 'worker_report:old' }, verifier]
      }
      if (mode === 'unreported') {
        f.db.db
          .prepare('DELETE FROM attempt_observation_facts WHERE dispatch_id = ?')
          .run(f.work.dispatchId)
      }
      expect(await f.post(evidence)).toMatchObject({
        ok: false,
        error: { code: 'manager_forbidden' }
      })
      expect(f.db.db.prepare('SELECT * FROM manager_objective_completions').all()).toEqual([])
      expect(f.db.db.prepare('SELECT * FROM manager_question_notifications').all()).toEqual([])
      expect(
        f.db.getMutationReceipt(`manager:${f.credential.principal.id}`, 'complete')
      ).toBeUndefined()
    }
  )

  it.each([
    'prose',
    'test-missing',
    'test-failed',
    'wrong-branch',
    'dirty-git',
    'wrong-attempt',
    'same-worker'
  ] as const)('refuses %s verification', async (mode) => {
    const f = await setup()
    const body = structuredClone(f.verificationBody)
    let raw: unknown = body
    if (mode === 'prose') {
      raw = 'It all works, trust me'
    }
    if (mode === 'test-missing') {
      body.tests = []
    }
    if (mode === 'test-failed') {
      body.tests[0].exitCode = 1
    }
    if (mode === 'wrong-branch') {
      body.git.branch = 'wrong'
    }
    if (mode === 'dirty-git') {
      body.git.clean = false
    }
    if (mode === 'wrong-attempt') {
      body.verifiedDispatchId = 'old-attempt'
    }
    const verifier = await f.verify(
      raw,
      mode === 'same-worker' ? `terminal-${f.work.taskId}` : undefined
    )
    expect(await f.post([f.work, verifier])).toMatchObject({
      ok: false,
      error: { code: 'manager_forbidden' }
    })
  })

  it('does not equate disconnect, idle, or a bare completed status with accepted evidence', async () => {
    const f = await setup()
    expect(await f.post([f.work])).toMatchObject({
      ok: false,
      error: { code: 'manager_forbidden' }
    })
    const verifier = await f.verify()
    f.db.db.prepare("UPDATE tasks SET status = 'blocked' WHERE id = ?").run(f.work.taskId)
    expect((await f.post([f.work, verifier])).ok).toBe(false)
  })

  it('requires pending human decisions to be answered, and does not treat final prose as approval', async () => {
    const f = await setup()
    const verifier = await f.verify()
    appendManagerConversation(f.db, {
      runId: f.runId,
      role: 'manager',
      kind: 'question',
      body: 'May I deploy?'
    })
    expect(await f.post([f.work, verifier])).toMatchObject({
      ok: false,
      error: { code: 'manager_forbidden' }
    })
    expect((await f.post([f.work, verifier], { kind: 'question' })).ok).toBe(false)
  })

  it('uses the existing approval gate store and never bypasses it with a successful report', async () => {
    const f = await setup()
    const verifier = await f.verify()
    f.db.createGate({
      taskId: f.work.taskId,
      question: 'Approve deployment?',
      options: ['yes', 'no']
    })
    expect(await f.post([f.work, verifier])).toMatchObject({
      ok: false,
      error: { code: 'manager_forbidden' }
    })
  })

  it.each(['revoked', 'replaced'] as const)('fences a %s final-result writer', async (mode) => {
    const f = await setup()
    const verifier = await f.verify()
    if (mode === 'revoked') {
      f.db.managerPrincipals.revoke(f.credential.principal.id)
    } else {
      f.db.db
        .prepare('UPDATE runs SET consumer_generation = consumer_generation + 1 WHERE id = ?')
        .run(f.runId)
    }
    expect((await f.post([f.work, verifier])).ok).toBe(false)
    expect(f.db.db.prepare('SELECT * FROM manager_objective_completions').all()).toEqual([])
  })

  it('freezes requirements in the Task receipt and includes exact verification bindings in its launch spec', async () => {
    const f = await setup()
    const verifier = await f.verify()
    const spec = f.db.getTask(verifier.taskId)?.spec ?? ''
    expect(spec).toContain(f.work.reportId)
    expect(spec).toContain(f.work.dispatchId)
    expect(spec).toContain('npm test')
    const params = {
      serviceToken: f.credential.token,
      lease: f.lease,
      runId: f.runId,
      requestId: 'frozen',
      spec: 'Work',
      completionRequirements: { role: 'work', tests: ['npm test'] }
    }
    const first = await f.call('manager.taskCreate', params)
    expect(first.ok).toBe(true)
    expect(await f.call('manager.taskCreate', params)).toEqual(first)
    expect(
      await f.call('manager.taskCreate', {
        ...params,
        completionRequirements: { role: 'work', tests: [] }
      })
    ).toMatchObject({ ok: false, error: { code: 'request_mismatch' } })
    const before = f.db.listTasks({ runId: f.runId }).length
    expect(
      (
        await f.call('manager.taskCreate', {
          ...params,
          requestId: 'invalid-verifier',
          completionRequirements: { role: 'verification', verifiesTaskId: 'unowned-task' }
        })
      ).ok
    ).toBe(false)
    expect(f.db.listTasks({ runId: f.runId })).toHaveLength(before)
  })

  it('rolls back result and certificate if queuing its notification fails', async () => {
    const f = await setup()
    const verifier = await f.verify()
    const prepare = f.db.db.prepare.bind(f.db.db)
    vi.spyOn(f.db.db, 'prepare').mockImplementation((sql) => {
      if (sql.includes('INSERT INTO manager_question_notifications')) {
        throw new Error('Injected queue failure')
      }
      return prepare(sql)
    })
    expect((await f.post([f.work, verifier])).ok).toBe(false)
    expect(f.db.db.prepare('SELECT * FROM manager_objective_completions').all()).toEqual([])
    expect(f.db.db.prepare('SELECT * FROM manager_conversation_messages').all()).toEqual([])
  })

  it('rechecks late digests, seals completed objectives, and requires a new human instruction for more work', async () => {
    const f = await setup()
    const verifier = await f.verify()
    const events: MobileNotificationEvent[] = []
    f.runtime.onNotificationDispatched((event) => events.push(event))
    expect((await f.post([f.work, verifier])).ok).toBe(true)
    expect(managerCompletionMessage(f.db, f.runId)).not.toBeNull()
    await expect(f.task()).rejects.toThrow('complete')
    appendManagerConversation(f.db, {
      runId: f.runId,
      role: 'human',
      kind: 'reply',
      body: 'Next objective step'
    })
    expect(await confirmNotificationDigestRelevance(f.runtime, events[0])).toBe(false)
    expect(managerCompletionMessage(f.db, f.runId)).toBeNull()
    expect(await f.task()).toBeTruthy()
  })

  it('supports non-Git folder tasks while still requiring a separate verifier', async () => {
    const f = await setup()
    const workId = await f.task({ role: 'work', tests: [] })
    const work = f.report(workId, 'Folder result')
    const verifierId = await f.task({ role: 'verification', verifiesTaskId: workId })
    const verifier = f.report(
      verifierId,
      JSON.stringify({
        version: 1,
        verifiedTaskId: workId,
        verifiedDispatchId: work.dispatchId,
        verifiedReportId: work.reportId,
        summary: 'Folder contents checked',
        tests: []
      })
    )
    const firstVerifier = await f.verify()
    expect((await f.post([f.work, work, verifier, firstVerifier])).ok).toBe(true)
    f.db.resetAll()
    expect(f.db.db.prepare('SELECT * FROM manager_task_requirements').all()).toEqual([])
    expect(f.db.db.prepare('SELECT * FROM manager_objective_completions').all()).toEqual([])
  })
})
