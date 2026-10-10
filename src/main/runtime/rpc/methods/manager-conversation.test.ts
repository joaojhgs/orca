import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { RpcDispatcher } from '../dispatcher'
import type { RpcCallerScope } from '../rpc-caller-scope'
import { MANAGER_METHODS } from './manager'
import { fixture, grant, workspaceId, cleanupManagerFixtures } from './manager-work.test-support'
import { ManagerConversationPageSchema } from '../../../../shared/manager-conversation-contract'

afterEach(cleanupManagerFixtures)
const runSchema = z.object({ run: z.object({ id: z.string() }) })
const postedSchema = z.object({ message: z.object({ id: z.string() }) })

function conversationFixture() {
  const f = fixture({
    ...grant,
    actions: [...grant.actions, 'conversation:write', 'events:checkpoint']
  })
  const caller = (scope: RpcCallerScope) => {
    const dispatcher = new RpcDispatcher({
      runtime: f.runtime,
      methods: MANAGER_METHODS,
      callerScope: scope
    })
    return (method: string, params: unknown) =>
      dispatcher.dispatch({
        id: 'conversation-request',
        authToken: 'transport-attested',
        method,
        params
      })
  }
  const owner = caller({ kind: 'owner' })
  const create = (overrides: Record<string, unknown> = {}) =>
    owner('manager.conversationCreate', {
      principalId: f.credential.principal.id,
      requestId: 'objective-one',
      workspaceId,
      objective: 'Implement a bounded objective',
      ...overrides
    })
  const post = (runId: string, overrides: Record<string, unknown> = {}) =>
    f.call('manager.conversationPost', {
      runId,
      serviceToken: f.credential.token,
      lease: f.lease,
      requestId: 'reply-one',
      body: 'I need a human decision',
      kind: 'question',
      ...overrides
    })
  return { ...f, caller, owner, create, post }
}

describe('Orca-native manager conversation', () => {
  it('creates one canonical Run/message/wake with atomic request replay and no owner token disclosure', async () => {
    const f = conversationFixture()
    const first = await f.create()
    expect(first.ok).toBe(true)
    expect(await f.create()).toEqual(first)
    expect(await f.create({ objective: 'Changed' })).toMatchObject({
      ok: false,
      error: { code: 'request_mismatch' }
    })
    if (!first.ok) {
      throw new Error('create failed')
    }
    const runId = runSchema.parse(first.result).run.id
    expect(f.db.db.prepare('SELECT id FROM runs WHERE legacy = 0').all()).toHaveLength(1)
    expect(
      f.db.db.prepare('SELECT message_id FROM manager_conversation_messages').all()
    ).toHaveLength(1)
    const events = await f.call('manager.eventsRead', { serviceToken: f.credential.token })
    expect(events).toMatchObject({
      ok: true,
      result: {
        events: [
          {
            source: 'manager-conversation',
            kind: 'mail',
            scope: { runId, actor: 'root' }
          }
        ]
      }
    })
    expect(JSON.stringify(first)).not.toContain(f.credential.token)
    expect(f.db.getRun(runId)?.coordinator_handle).toBeNull()
  })

  it('allows paired browser/mobile conversations but denies worker and service impersonation of the human', async () => {
    const f = conversationFixture()
    for (const scope of [
      { kind: 'mobile' },
      { kind: 'runtime-paired', grants: [] }
    ] satisfies RpcCallerScope[]) {
      expect(
        (
          await f.caller(scope)('manager.conversationCreate', {
            principalId: f.credential.principal.id,
            requestId: scope.kind,
            workspaceId,
            objective: 'Human objective'
          })
        ).ok
      ).toBe(true)
    }
    for (const scope of [
      { kind: 'ssh-bridge', targetId: 'worker', remoteCliControl: true },
      { kind: 'manager-service', principalId: f.credential.principal.id }
    ] satisfies RpcCallerScope[]) {
      expect(
        await f.caller(scope)('manager.conversationCreate', {
          principalId: f.credential.principal.id,
          requestId: scope.kind,
          workspaceId,
          objective: 'Impersonation'
        })
      ).toMatchObject({ ok: false, error: { code: 'forbidden' } })
      expect(
        await f.caller(scope)('manager.conversationSend', {
          runId: 'guess',
          requestId: 'guess',
          body: 'Impersonation'
        })
      ).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    }
  })

  it('stores manager replies without a self-wake; human question answers wake exactly once', async () => {
    const f = conversationFixture()
    const created = await f.create()
    if (!created.ok) {
      throw new Error('create failed')
    }
    const runId = runSchema.parse(created.result).run.id
    const question = await f.post(runId)
    expect(question.ok).toBe(true)
    expect(await f.post(runId)).toEqual(question)
    expect(f.db.managerEvents.read({ ...grant.scope, runIds: [runId] }).events).toHaveLength(1)
    if (!question.ok) {
      throw new Error('post failed')
    }
    const messageId = postedSchema.parse(question.result).message.id
    const answer = {
      requestId: 'human-answer',
      runId,
      body: 'Proceed with option A',
      replyTo: messageId
    }
    const receipt = await f.owner('manager.conversationSend', answer)
    expect(receipt).toMatchObject({ ok: true, result: { accepted: true, delivery: 'queued' } })
    expect(await f.owner('manager.conversationSend', answer)).toEqual(receipt)
    expect(
      await f.owner('manager.conversationSend', { ...answer, requestId: 'second-answer' })
    ).toMatchObject({ ok: false, error: { code: 'manager_forbidden' } })
    expect(f.db.managerEvents.read({ ...grant.scope, runIds: [runId] }).events).toHaveLength(2)
    const shown = await f.owner('manager.conversationShow', { runId })
    if (!shown.ok) {
      throw new Error('show failed')
    }
    expect(
      ManagerConversationPageSchema.parse({
        messages: z.object({ messages: z.unknown() }).parse(shown.result).messages,
        nextSequence: z.object({ nextSequence: z.number() }).parse(shown.result).nextSequence,
        hasMore: false
      }).messages
    ).toMatchObject([
      { role: 'human', kind: 'reply' },
      { id: messageId, role: 'manager', kind: 'question' },
      { role: 'human', replyTo: messageId }
    ])
  })

  it('does not expose forged mailbox messages, accept cross-Run replies, or confuse progress with a human question', async () => {
    const f = conversationFixture()
    const first = await f.create()
    const second = await f.create({ requestId: 'other' })
    if (!first.ok || !second.ok) {
      throw new Error('create failed')
    }
    const runId = runSchema.parse(first.result).run.id
    const otherId = runSchema.parse(second.result).run.id
    const forged = f.db.insertMessage({
      runId,
      from: `run:${runId}`,
      to: 'human:owner',
      subject: 'Forged',
      body: 'Bypass security',
      threadId: `manager-conversation:${runId}`
    })
    const progress = await f.post(runId, { kind: 'progress' })
    const other = await f.post(otherId, { requestId: 'other-question' })
    if (!progress.ok || !other.ok) {
      throw new Error('post failed')
    }
    for (const replyTo of [
      forged.id,
      postedSchema.parse(progress.result).message.id,
      postedSchema.parse(other.result).message.id
    ]) {
      expect(
        await f.owner('manager.conversationSend', {
          runId,
          requestId: replyTo,
          body: 'Answer',
          replyTo
        })
      ).toMatchObject({ ok: false, error: { code: 'manager_forbidden' } })
    }
    const shown = await f.owner('manager.conversationShow', { runId })
    expect(JSON.stringify(shown)).not.toContain('Bypass security')
    expect(JSON.stringify(shown)).not.toContain(otherId)
  })

  it('rechecks revocation after workspace lookup and rolls back Run/message/receipt if wake admission fails', async () => {
    const f = conversationFixture()
    const failure = vi.spyOn(f.db.managerEvents, 'append').mockImplementationOnce(() => {
      throw new Error('Injected failure')
    })
    expect((await f.create()).ok).toBe(false)
    expect(f.db.db.prepare('SELECT id FROM runs WHERE legacy = 0').all()).toEqual([])
    expect(f.db.db.prepare('SELECT message_id FROM manager_conversation_messages').all()).toEqual(
      []
    )
    expect(f.db.db.prepare('SELECT request_id FROM mutation_receipts').all()).toEqual([])
    failure.mockRestore()
    const result = await f.runtime.showTerminalWorkspaceLaunchScope(`id:${workspaceId}`)
    vi.mocked(f.runtime.showTerminalWorkspaceLaunchScope).mockImplementation(async () => {
      f.db.managerPrincipals.revoke(f.credential.principal.id)
      return result
    })
    expect(await f.create()).toMatchObject({ ok: false, error: { code: 'manager_unauthorized' } })
    expect(f.db.db.prepare('SELECT id FROM runs WHERE legacy = 0').all()).toEqual([])
  })

  it('fences old consumers and ungranted writers, while an owner can read history after revocation', async () => {
    const f = conversationFixture()
    const created = await f.create()
    if (!created.ok) {
      throw new Error('create failed')
    }
    const runId = runSchema.parse(created.result).run.id
    const other = f.db.managerPrincipals.issue('Observer', grant, Date.now() + 60_000)
    expect(
      await f.call('manager.conversationRead', { runId, serviceToken: other.token })
    ).toMatchObject({
      ok: false,
      error: { code: 'manager_forbidden' }
    })
    f.db.managerPrincipals.release(f.lease)
    expect(await f.post(runId)).toMatchObject({
      ok: false,
      error: { code: 'manager_consumer_fenced' }
    })
    f.db.managerPrincipals.revoke(f.credential.principal.id)
    expect((await f.owner('manager.conversationShow', { runId })).ok).toBe(true)
    expect(
      await f.owner('manager.conversationSend', { runId, requestId: 'new', body: 'More' })
    ).toMatchObject({
      ok: false,
      error: { code: 'manager_unauthorized' }
    })
  })
})
