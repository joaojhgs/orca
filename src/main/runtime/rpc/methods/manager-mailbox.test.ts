import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  fixture,
  grant,
  runResult,
  workspaceId,
  cleanupManagerFixtures
} from './manager-work.test-support'
import { managerWorkspaceScope } from '../../manager/manager-hook-scope'

afterEach(cleanupManagerFixtures)
const deliveryResult = z.object({
  deliveryId: z.string(),
  messages: z.array(z.object({ id: z.string() }))
})
const messageResult = z.object({ messageId: z.string() })

async function mailboxFixture() {
  const f = fixture({
    ...grant,
    actions: [...grant.actions, 'events:checkpoint', 'worker:guide', 'question:answer']
  })
  const created = await f.runCreate()
  if (!created.ok) {
    throw new Error('Run creation failed')
  }
  const runId = runResult.parse(created.result).run.id
  const started = f.db.createStartingWorkerDispatch({
    creator: { kind: 'system' },
    maxDepth: 2,
    taskSpec: 'Work',
    taskRunId: runId,
    startOptions: {
      managerScope: managerWorkspaceScope(workspaceId, 'ssh:worker', f.runtime.listRepos(), [])
    }
  })
  f.db.prepareStartingWorkerAuthority({
    dispatchId: started.dispatch.id,
    handle: 'worker',
    paneKey: 'worker-pane',
    processIncarnation: 'incarnation',
    worktreeId: workspaceId,
    hostScope: JSON.stringify({ kind: 'ssh', targetId: 'worker' }),
    effects: [],
    setupState: 'not_applicable'
  })
  vi.spyOn(f.runtime, 'notifyMessageArrived').mockImplementation(() => {})
  const params = { serviceToken: f.credential.token, lease: f.lease, runId }
  return { ...f, params, dispatchId: started.dispatch.id }
}

describe('service-owned manager mailboxes', () => {
  it('replays an outstanding batch until explicitly acknowledged by the fenced consumer', async () => {
    const f = await mailboxFixture()
    const msg = f.db.insertMessage({
      from: `dispatch:${f.dispatchId}`,
      to: `run:${f.params.runId}`,
      runId: f.params.runId,
      subject: 'Result'
    })
    const first = await f.call('manager.mailboxCheck', f.params)
    expect(first).toMatchObject({
      ok: true,
      result: { replayed: false, messages: [{ id: msg.id }] }
    })
    if (!first.ok) {
      throw new Error('Mailbox check failed')
    }
    const deliveryId = deliveryResult.parse(first.result).deliveryId
    expect(await f.call('manager.mailboxCheck', f.params)).toMatchObject({
      ok: true,
      result: { deliveryId, replayed: true }
    })
    const ack = { ...f.params, deliveryId }
    expect(await f.call('manager.mailboxAck', ack)).toMatchObject({
      ok: true,
      result: { acknowledged: true, duplicate: false }
    })
    expect(await f.call('manager.mailboxAck', ack)).toMatchObject({
      ok: true,
      result: { duplicate: true }
    })
    expect(await f.call('manager.mailboxCheck', f.params)).toMatchObject({
      ok: true,
      result: { messages: [], deliveryId: null }
    })
  })

  it('does not acknowledge another Run or let a replaced consumer read/acknowledge', async () => {
    const f = await mailboxFixture()
    const other = f.db.createRun({
      objective: 'User',
      coordinatorHandle: 'user',
      coordinatorPaneKey: 'pane'
    })
    expect(await f.call('manager.mailboxCheck', { ...f.params, runId: other.id })).toMatchObject({
      ok: false,
      error: { code: 'manager_forbidden' }
    })
    f.db.managerPrincipals.release(f.lease)
    f.db.managerPrincipals.claim(f.credential.principal.id, 'replacement')
    expect(await f.call('manager.mailboxCheck', f.params)).toMatchObject({
      ok: false,
      error: { code: 'manager_consumer_fenced' }
    })
    expect(
      await f.call('manager.mailboxAck', { ...f.params, deliveryId: 'some-id' })
    ).toMatchObject({ ok: false, error: { code: 'manager_consumer_fenced' } })
  })

  it('queues one durable follow-up without claiming delivery or injecting raw terminal input', async () => {
    const f = await mailboxFixture()
    const params = {
      ...f.params,
      dispatchId: f.dispatchId,
      requestId: 'guide',
      body: 'Check the regression first'
    }
    const first = await f.call('manager.workerGuide', params)
    expect(first).toMatchObject({ ok: true, result: { accepted: true, delivery: 'queued' } })
    expect(await f.call('manager.workerGuide', params)).toEqual(first)
    expect(f.db.getUnreadMessages(`dispatch:${f.dispatchId}`)).toHaveLength(1)
    expect(await f.call('manager.workerGuide', { ...params, body: 'Different' })).toMatchObject({
      ok: false,
      error: { code: 'request_mismatch' }
    })
  })

  it('answers only a recorded owned-worker question and preserves idempotency/conflict handling', async () => {
    const f = await mailboxFixture()
    const question = f.db.createQuestion({
      runId: f.params.runId,
      dispatchId: f.dispatchId,
      askerHandle: 'worker',
      question: 'Which branch?'
    }).question
    const params = {
      ...f.params,
      messageId: question.message_id,
      requestId: 'answer',
      body: 'Use the assigned feature branch'
    }
    const result = await f.call('manager.questionAnswer', params)
    expect(result).toMatchObject({ ok: true, result: { accepted: true } })
    if (!result.ok) {
      throw new Error('Question answer failed')
    }
    const messageId = messageResult.parse(result.result).messageId
    expect(f.db.getQuestion(question.message_id)).toMatchObject({
      status: 'answered',
      answer_message_id: messageId,
      answer_body: params.body
    })
    expect(await f.call('manager.questionAnswer', params)).toEqual(result)
    expect(
      await f.call('manager.questionAnswer', {
        ...params,
        requestId: 'conflict',
        body: 'Use a different branch'
      })
    ).toMatchObject({ ok: false, error: { code: 'answer_conflict' } })
    expect(
      await f.call('manager.questionAnswer', { ...params, messageId: 'unrecorded' })
    ).toMatchObject({ ok: false, error: { code: 'manager_forbidden' } })
  })

  it('revocation prevents guidance and answers without stopping the worker', async () => {
    const f = await mailboxFixture()
    f.db.managerPrincipals.revoke(f.credential.principal.id)
    expect(
      await f.call('manager.workerGuide', {
        ...f.params,
        dispatchId: f.dispatchId,
        requestId: 'revoked',
        body: 'Follow up'
      })
    ).toMatchObject({ ok: false, error: { code: 'manager_unauthorized' } })
    expect(f.db.getWorkerDispatch(f.dispatchId)?.state).toBe('starting')
    expect(f.db.getUnreadMessages(`dispatch:${f.dispatchId}`)).toEqual([])
  })

  it('journals questions and accepted settlement atomically, without inventing process exit', async () => {
    const f = await mailboxFixture()
    const question = f.db.createQuestion({
      runId: f.params.runId,
      dispatchId: f.dispatchId,
      askerHandle: 'worker',
      question: 'Which branch?'
    }).question
    const observedGrant = f.db.managerRuns.observationGrant(
      f.credential.principal.id,
      f.credential.principal.grant.scope
    )
    expect(f.db.managerEvents.read(observedGrant).events).toMatchObject([
      {
        kind: 'question',
        messageId: question.message_id,
        scope: { runId: f.params.runId, dispatchId: f.dispatchId, actor: 'worker' }
      }
    ])
    const dispatch = f.db.getDispatchContextById(f.dispatchId)
    if (!dispatch) {
      throw new Error('Dispatch missing')
    }
    expect(
      f.db.settleWorkerReport({
        taskId: dispatch.task_id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        result: 'Verified work'
      })
    ).toMatchObject({ action: 'settled' })
    const events = f.db.managerEvents.read(observedGrant).events
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ kind: 'dispatch-settled', outcome: 'succeeded' })
    expect(events[1]).not.toHaveProperty('liveness')
    f.db.settleWorkerReport({
      taskId: dispatch.task_id,
      dispatchId: dispatch.id,
      outcome: 'succeeded',
      result: 'Verified work'
    })
    expect(f.db.managerEvents.read(observedGrant).events).toHaveLength(2)
  })

  it('does not journal rolled-back questions', async () => {
    const f = await mailboxFixture()
    f.db.db.exec('BEGIN IMMEDIATE')
    f.db.createQuestion({
      runId: f.params.runId,
      dispatchId: f.dispatchId,
      askerHandle: 'worker',
      question: 'Rollback test'
    })
    f.db.db.exec('ROLLBACK')
    const observedGrant = f.db.managerRuns.observationGrant(
      f.credential.principal.id,
      f.credential.principal.grant.scope
    )
    expect(f.db.managerEvents.read(observedGrant).events).toHaveLength(0)
    expect(f.db.getUnreadRunMailbox(f.params.runId)).toHaveLength(0)
  })
})
