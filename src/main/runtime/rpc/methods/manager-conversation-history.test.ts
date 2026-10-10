import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { RpcDispatcher } from '../dispatcher'
import { MANAGER_METHODS } from './manager'
import { fixture, grant, cleanupManagerFixtures } from './manager-work.test-support'
import { ManagerConversationPageSchema } from '../../../../shared/manager-conversation-contract'

afterEach(cleanupManagerFixtures)
const runResult = z.object({ run: z.object({ id: z.string() }) })

describe('bounded manager conversation history and authority', () => {
  it('paginates large bodies without exceeding the CLI read budget or losing messages', async () => {
    const f = fixture({ ...grant, actions: [...grant.actions, 'conversation:write'] })
    const created = await f.runCreate()
    if (!created.ok) {
      throw new Error('create failed')
    }
    const runId = runResult.parse(created.result).run.id
    for (let i = 0; i < 12; i++) {
      expect(
        (
          await f.call('manager.conversationPost', {
            runId,
            serviceToken: f.credential.token,
            lease: f.lease,
            requestId: `reply-${i}`,
            body: 'x'.repeat(32_000)
          })
        ).ok
      ).toBe(true)
    }
    let afterSequence = 0
    const seen: string[] = []
    for (let pages = 0; pages < 12; pages++) {
      const response = await f.call('manager.conversationRead', {
        runId,
        serviceToken: f.credential.token,
        afterSequence,
        limit: 100
      })
      if (!response.ok) {
        throw new Error('read failed')
      }
      const { messages, ...page } = z
        .object({
          messages: ManagerConversationPageSchema.shape.messages,
          nextSequence: z.number(),
          hasMore: z.boolean()
        })
        .parse(response.result)
      expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThan(256 * 1024)
      expect(page.nextSequence).toBeGreaterThan(afterSequence)
      seen.push(...messages.map((message) => message.id))
      afterSequence = page.nextSequence
      if (!page.hasMore) {
        break
      }
    }
    expect(seen).toHaveLength(12)
    expect(new Set(seen).size).toBe(12)
  })

  it('requires the explicit conversation grant even when the service owns the Run', async () => {
    const f = fixture()
    const created = await f.runCreate()
    if (!created.ok) {
      throw new Error('create failed')
    }
    const runId = runResult.parse(created.result).run.id
    expect(
      await f.call('manager.conversationPost', {
        runId,
        serviceToken: f.credential.token,
        lease: f.lease,
        requestId: 'unguarded',
        body: 'Claim'
      })
    ).toMatchObject({ ok: false, error: { code: 'manager_forbidden' } })
    expect(f.db.db.prepare('SELECT message_id FROM manager_conversation_messages').all()).toEqual(
      []
    )
  })

  it('lists only service-owned conversations and exposes no credential hashes or consumer identities', async () => {
    const f = fixture()
    const created = await f.runCreate()
    if (!created.ok) {
      throw new Error('create failed')
    }
    const runId = runResult.parse(created.result).run.id
    f.db.createRun({
      objective: 'User project',
      coordinatorHandle: 'user',
      coordinatorPaneKey: 'pane'
    })
    const owner = new RpcDispatcher({
      runtime: f.runtime,
      methods: MANAGER_METHODS,
      callerScope: { kind: 'runtime-paired', grants: [] }
    })
    const call = (method: string) =>
      owner.dispatch({ id: 'owner', authToken: 'attested', method, params: {} })
    const conversations = await call('manager.conversationsList')
    expect(conversations).toMatchObject({ ok: true, result: { conversations: [{ runId }] } })
    expect(JSON.stringify(conversations)).not.toContain('User project')
    const principals = await call('manager.principalsList')
    expect(principals).toMatchObject({
      ok: true,
      result: { principals: [{ state: 'active', consumerConnected: true }] }
    })
    for (const secret of [f.credential.token, 'token_hash', 'consumer_id', 'adapter']) {
      expect(JSON.stringify(principals)).not.toContain(secret)
    }
    expect(await f.call('manager.principalsList', {})).toMatchObject({
      ok: false,
      error: { code: 'forbidden' }
    })
    f.db.db
      .prepare('UPDATE runs SET consumer_generation = consumer_generation + 1 WHERE id = ?')
      .run(runId)
    expect(await call('manager.conversationsList')).toMatchObject({
      ok: true,
      result: { conversations: [] }
    })
  })
})
