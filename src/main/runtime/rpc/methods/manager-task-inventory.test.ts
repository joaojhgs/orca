import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { fixture, grant, runResult, cleanupManagerFixtures } from './manager-work.test-support'

afterEach(cleanupManagerFixtures)
const runPage = z.object({
  runs: z.array(z.object({ run: z.object({ id: z.string() }) })),
  nextOffset: z.number().nullable()
})
const taskPage = z.object({
  tasks: z.array(z.object({ id: z.string() }).passthrough()),
  nextOffset: z.number().nullable()
})

describe('scoped manager task inventory', () => {
  it('keeps the existing reset path usable and removes ownership with its Run', async () => {
    const f = fixture()
    expect((await f.runCreate()).ok).toBe(true)
    f.db.resetAll()
    expect(f.db.db.prepare('SELECT run_id FROM manager_run_ownership').all()).toEqual([])
    expect(f.db.managerRuns.ownedScopes(f.credential.principal.id, grant.scope)).toEqual([])
  })
  it('pages only owned Runs and drops taken-over Runs without exposing user objectives', async () => {
    const f = fixture()
    const owned: string[] = []
    for (let index = 0; index < 3; index++) {
      const result = await f.runCreate({ requestId: `run-${index}` })
      if (!result.ok) {
        throw new Error('create failed')
      }
      owned.push(runResult.parse(result.result).run.id)
    }
    f.db.createRun({
      objective: 'PRIVATE_USER_OBJECTIVE',
      coordinatorHandle: 'user',
      coordinatorPaneKey: 'pane'
    })
    const params = { serviceToken: f.credential.token, limit: 2 }
    const first = await f.call('manager.runList', params)
    if (!first.ok) {
      throw new Error('list failed')
    }
    const page = runPage.parse(first.result)
    expect(page.runs).toHaveLength(2)
    expect(page.nextOffset).toBe(2)
    const second = await f.call('manager.runList', { ...params, offset: page.nextOffset })
    if (!second.ok) {
      throw new Error('next page failed')
    }
    const last = runPage.parse(second.result)
    expect(last.nextOffset).toBeNull()
    expect([...page.runs, ...last.runs].map(({ run }) => run.id).sort()).toEqual(owned.sort())
    expect(JSON.stringify([first, second])).not.toContain('PRIVATE_USER_OBJECTIVE')
    f.db.db
      .prepare('UPDATE runs SET consumer_generation = consumer_generation + 1 WHERE id = ?')
      .run(owned[0])
    const after = await f.call('manager.runList', { ...params, limit: 200 })
    if (!after.ok) {
      throw new Error('list after takeover failed')
    }
    expect(runPage.parse(after.result).runs.map(({ run }) => run.id)).not.toContain(owned[0])
  })

  it('bounds SQL task reads, returns summaries, and requires both task and Run ownership', async () => {
    const f = fixture()
    const created = await f.runCreate()
    if (!created.ok) {
      throw new Error('create failed')
    }
    const runId = runResult.parse(created.result).run.id
    const ids = Array.from(
      { length: 5 },
      () => f.db.createTask({ runId, spec: 'PRIVATE_TASK_SPEC', taskTitle: 'Summary' }).id
    )
    const foreignRun = f.db.createRun({
      objective: 'Other',
      coordinatorHandle: null,
      coordinatorPaneKey: null
    })
    const foreign = f.db.createTask({ runId: foreignRun.id, spec: 'PRIVATE_FOREIGN_SPEC' })
    const list = vi.spyOn(f.db, 'listTasks')
    const seen: string[] = []
    let offset: number | null = 0
    while (offset !== null) {
      const result = await f.call('manager.taskList', {
        serviceToken: f.credential.token,
        runId,
        offset,
        limit: 2
      })
      if (!result.ok) {
        throw new Error('list failed')
      }
      const page = taskPage.parse(result.result)
      expect(page.tasks.length).toBeLessThanOrEqual(2)
      expect(JSON.stringify(result)).not.toContain('PRIVATE_TASK_SPEC')
      seen.push(...page.tasks.map(({ id }) => id))
      offset = page.nextOffset
    }
    expect(seen.sort()).toEqual(ids.sort())
    expect(list.mock.calls).toEqual([0, 2, 4].map((offset) => [{ runId, limit: 3, offset }]))
    const shown = await f.call('manager.taskShow', {
      serviceToken: f.credential.token,
      runId,
      taskId: ids[0]
    })
    expect(shown).toMatchObject({ ok: true, result: { task: { spec: 'PRIVATE_TASK_SPEC' } } })
    const wrong = await f.call('manager.taskShow', {
      serviceToken: f.credential.token,
      runId,
      taskId: foreign.id
    })
    expect(wrong).toMatchObject({ ok: false, error: { code: 'manager_forbidden' } })
    expect(JSON.stringify(wrong)).not.toContain('PRIVATE_FOREIGN_SPEC')
    expect(
      await f.call('manager.taskList', { serviceToken: f.credential.token, runId: foreignRun.id })
    ).toMatchObject({ ok: false, error: { code: 'manager_forbidden' } })
  })

  it('rejects revoked credentials, missing inventory action and oversized pages before reads', async () => {
    const f = fixture()
    const created = await f.runCreate()
    if (!created.ok) {
      throw new Error('create failed')
    }
    const runId = runResult.parse(created.result).run.id
    const params = { serviceToken: f.credential.token, runId }
    const list = vi.spyOn(f.db, 'listTasks')
    expect((await f.call('manager.taskList', { ...params, limit: 201 })).ok).toBe(false)
    f.db.managerPrincipals.revoke(f.credential.principal.id)
    expect(await f.call('manager.taskList', params)).toMatchObject({
      ok: false,
      error: { code: 'manager_unauthorized' }
    })
    expect(list).not.toHaveBeenCalled()
    const restricted = fixture({ ...grant, actions: ['run:create'] })
    expect(
      await restricted.call('manager.runList', { serviceToken: restricted.credential.token })
    ).toMatchObject({ ok: false, error: { code: 'manager_forbidden' } })
  })
})
