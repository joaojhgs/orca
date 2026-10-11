import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupManagerFixtures,
  fixture,
  grant,
  runResult
} from '../rpc/methods/manager-work.test-support'
import type { MobileNotificationEvent } from '../runtime-mobile-notification-controller'
import { appendManagerConversation } from './manager-conversation-messages'
import {
  deliverPendingManagerQuestions,
  startManagerQuestionNotificationRecovery
} from './manager-question-notifications'
import { readManagerNotificationTarget } from '../../../shared/manager-notification-target'
import { runLifecycleWriteTransaction } from '../orchestration/db/lifecycle-write-transaction-runner'
import { createHarness, flush, registration } from '../push/push-dispatcher.test-fixture'
import { PushSendRequestSchema } from '../../../../cloud/packages/push-contract/src/send-messages'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrchestrationDb } from '../orchestration/db'

afterEach(() => {
  vi.useRealTimers()
  cleanupManagerFixtures()
})

async function questions() {
  const f = fixture({ ...grant, actions: [...grant.actions, 'conversation:write'] })
  const created = await f.runCreate()
  if (!created.ok) {
    throw new Error('Run creation failed')
  }
  const runId = runResult.parse(created.result).run.id
  const append = (kind: 'question' | 'reply' | 'progress' = 'question') =>
    appendManagerConversation(f.db, {
      runId,
      role: 'manager',
      kind,
      body: 'Private question details'
    })
  const post = (kind: 'question' | 'reply' | 'progress' = 'question') =>
    f.call('manager.conversationPost', {
      runId,
      kind,
      body: 'Private question details',
      requestId: `post-${kind}`,
      serviceToken: f.credential.token,
      lease: f.lease
    })
  const intents = () => f.db.db.prepare('SELECT * FROM manager_question_notifications').all()
  return { ...f, runId, append, post, intents }
}

describe('manager question notification handoff', () => {
  it('queues only explicit questions, after commit, and never duplicates an acknowledged RPC replay', async () => {
    const f = await questions()
    const events: MobileNotificationEvent[] = []
    f.runtime.onNotificationDispatched((event) => {
      expect(f.db.db.isTransaction).toBe(false)
      events.push(event)
    })
    expect((await f.post('reply')).ok).toBe(true)
    expect((await f.post('progress')).ok).toBe(true)
    expect(events).toEqual([])
    const first = await f.post()
    expect(first.ok).toBe(true)
    expect(await f.post()).toEqual(first)
    deliverPendingManagerQuestions(f.runtime)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'notification',
      source: 'plugin',
      notificationKind: 'question',
      worktreeId: 'repo::/repo',
      notificationScope: { executionHostId: 'ssh:worker', actor: 'manager', sessionId: f.runId }
    })
    expect(readManagerNotificationTarget(events[0]?.notificationId)?.runId).toBe(f.runId)
    expect(JSON.stringify(events)).not.toContain('Private question details')
    expect(f.intents()).toMatchObject([{ disposition: 'handed-off' }])
  })

  it('uses the existing strict gateway protocol and does not collapse distinct questions', async () => {
    const f = await questions()
    const gateway = createHarness({
      devices: [{ deviceId: 'phone', pushRegistration: registration() }]
    })
    f.runtime.onNotificationDispatched((event) => gateway.dispatcher.enqueue(event))
    const messages = [f.append(), f.append()]
    deliverPendingManagerQuestions(f.runtime)
    await flush()
    expect(gateway.sends).toHaveLength(2)
    for (const [index, send] of gateway.sends.entries()) {
      expect(PushSendRequestSchema.safeParse({ v: 1, ...send }).success).toBe(true)
      expect(readManagerNotificationTarget(send.notification.notificationId)).toEqual({
        runId: f.runId,
        messageId: messages[index]?.id
      })
      expect(send.notification).toMatchObject({
        source: 'plugin',
        agentState: null,
        worktreeId: 'repo::/repo'
      })
      expect(send.notification).not.toHaveProperty('managerRunId')
    }
  })

  it('does not publish or leave an intent for a transaction that rolls back', async () => {
    const f = await questions()
    const listener = vi.fn()
    f.runtime.onNotificationDispatched(listener)
    expect(() =>
      runLifecycleWriteTransaction(f.db.db, 'rollback_question', () => {
        f.append()
        throw new Error('Abort receipt')
      })
    ).toThrow('Abort receipt')
    deliverPendingManagerQuestions(f.runtime)
    expect(f.intents()).toEqual([])
    expect(listener).not.toHaveBeenCalled()
  })

  it('defers a nested transaction and fences reentrant drains while handing off', async () => {
    const f = await questions()
    const listener = vi.fn(() => deliverPendingManagerQuestions(f.runtime))
    f.runtime.onNotificationDispatched(listener)
    runLifecycleWriteTransaction(f.db.db, 'nested_question', () => {
      f.append()
      deliverPendingManagerQuestions(f.runtime)
      expect(listener).not.toHaveBeenCalled()
    })
    deliverPendingManagerQuestions(f.runtime)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('retains a committed intent until fanout exists, then recovers with its canonical message ID', async () => {
    const f = await questions()
    expect((await f.post()).ok).toBe(true)
    expect(f.intents()).toMatchObject([{ processed_at: null }])
    const listener = vi.fn()
    f.runtime.onNotificationDispatched(listener)
    const stop = startManagerQuestionNotificationRecovery(f.runtime)
    stop()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(f.intents()).toMatchObject([{ disposition: 'handed-off' }])
  })

  it('recovers a persisted intent from a newly opened SQLite database and still deduplicates its RPC receipt', async () => {
    const f = await questions()
    const accepted = await f.post()
    const directory = mkdtempSync(join(tmpdir(), 'orca-manager-question-'))
    let restored: OrchestrationDb | null = null
    try {
      const path = join(directory, 'orchestration.db')
      await f.db.db.backup(path)
      restored = new OrchestrationDb(path)
      f.runtime.setOrchestrationDb(restored)
      const listener = vi.fn()
      f.runtime.onNotificationDispatched(listener)
      const stop = startManagerQuestionNotificationRecovery(f.runtime)
      stop()
      expect(listener).toHaveBeenCalledOnce()
      expect(await f.post()).toEqual(accepted)
      expect(listener).toHaveBeenCalledOnce()
      expect(
        restored.db.prepare('SELECT disposition FROM manager_question_notifications').all()
      ).toEqual([{ disposition: 'handed-off' }])
    } finally {
      restored?.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('does not turn a notification failure into a failed accepted message, and replays only the handoff', async () => {
    const f = await questions()
    const listener = vi.fn()
    f.runtime.onNotificationDispatched(listener)
    vi.spyOn(f.runtime, 'dispatchMobileNotification').mockImplementationOnce(() => {
      throw new Error('Fanout unavailable')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await f.post()).ok).toBe(true)
    expect(warn).toHaveBeenCalledOnce()
    expect(f.intents()).toMatchObject([{ processed_at: null }])
    expect(listener).not.toHaveBeenCalled()
    deliverPendingManagerQuestions(f.runtime)
    expect(listener).toHaveBeenCalledOnce()
    expect(f.intents()).toHaveLength(1)
  })

  it.each(['answered', 'revoked', 'expired', 'replaced'] as const)(
    'retires %s questions without announcing them',
    async (reason) => {
      const f = await questions()
      const message = f.append()
      if (reason === 'answered') {
        appendManagerConversation(f.db, {
          runId: f.runId,
          role: 'human',
          kind: 'reply',
          body: 'Answered',
          replyTo: message.id
        })
      } else if (reason === 'revoked') {
        f.db.managerPrincipals.revoke(f.credential.principal.id)
      } else if (reason === 'expired') {
        f.db.db
          .prepare('UPDATE manager_principals SET expires_at = 0 WHERE id = ?')
          .run(f.credential.principal.id)
      } else {
        f.db.db
          .prepare('UPDATE runs SET consumer_generation = consumer_generation + 1 WHERE id = ?')
          .run(f.runId)
      }
      const listener = vi.fn()
      f.runtime.onNotificationDispatched(listener)
      deliverPendingManagerQuestions(f.runtime)
      expect(listener).not.toHaveBeenCalled()
      expect(f.intents()).toMatchObject([
        { disposition: reason === 'answered' ? 'answered' : 'fenced' }
      ])
    }
  )

  it('honors manager-specific human mutes without muting the durable human-to-manager wake', async () => {
    const f = await questions()
    f.runtime.configureNotificationScopePolicy({
      read: () => ({
        rules: [
          {
            id: 'quiet-manager',
            selector: { level: 'server' },
            actor: 'manager',
            human: { mode: 'off' }
          }
        ]
      }),
      scope: (event) => event.notificationScope ?? {}
    })
    f.append()
    const listener = vi.fn()
    f.runtime.onNotificationDispatched(listener)
    deliverPendingManagerQuestions(f.runtime)
    expect(listener).not.toHaveBeenCalled()
    expect(f.intents()).toMatchObject([{ disposition: 'muted' }])
    appendManagerConversation(f.db, {
      runId: f.runId,
      role: 'human',
      kind: 'reply',
      body: 'Follow up'
    })
    expect(f.db.managerEvents.read({ ...grant.scope, runIds: [f.runId] }).events).toMatchObject([
      { kind: 'mail', scope: { actor: 'root' } }
    ])
    f.runtime.configureNotificationScopePolicy({
      read: () => undefined,
      scope: (event) => event.notificationScope ?? {}
    })
    deliverPendingManagerQuestions(f.runtime)
    expect(listener).not.toHaveBeenCalled()
  })

  it('bounds recovery batches and does not collapse independent questions in the same workspace', async () => {
    const f = await questions()
    for (let index = 0; index < 52; index++) {
      f.append()
    }
    const listener = vi.fn()
    f.runtime.onNotificationDispatched(listener)
    deliverPendingManagerQuestions(f.runtime)
    expect(listener).toHaveBeenCalledTimes(50)
    deliverPendingManagerQuestions(f.runtime)
    deliverPendingManagerQuestions(f.runtime)
    expect(listener).toHaveBeenCalledTimes(52)
    expect(new Set(listener.mock.calls.map(([event]) => event.notificationId)).size).toBe(52)
  })

  it('retries pending handoffs on the bounded startup timer and stops cleanly', async () => {
    vi.useFakeTimers()
    const f = await questions()
    const stop = startManagerQuestionNotificationRecovery(f.runtime)
    f.append()
    const listener = vi.fn()
    f.runtime.onNotificationDispatched(listener)
    vi.advanceTimersByTime(5_000)
    expect(listener).toHaveBeenCalledOnce()
    stop()
    f.append()
    vi.advanceTimersByTime(10_000)
    expect(listener).toHaveBeenCalledOnce()
  })
})
