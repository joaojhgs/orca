import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManagerPrincipalGrant } from '../../../../shared/manager-principal-contract'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import {
  fixture,
  grant,
  runResult,
  repo,
  workspaceId,
  cleanupManagerFixtures
} from './manager-work.test-support'
afterEach(cleanupManagerFixtures)

describe('manager-owned Orca Runs', () => {
  it('owns multiple Runs without stealing a user coordinator or a global current-Run binding', async () => {
    const f = fixture()
    const user = f.db.createRun({
      objective: 'Existing Aurora',
      coordinatorHandle: 'user-terminal',
      coordinatorPaneKey: 'user-pane'
    })
    const one = await f.runCreate()
    const two = await f.runCreate({ requestId: 'create-two', objective: 'Other objective' })
    if (!one.ok || !two.ok) {
      throw new Error(JSON.stringify([one, two]))
    }
    const first = runResult.parse(one.result).run.id
    const second = runResult.parse(two.result).run.id
    expect(second).not.toBe(first)
    expect(f.db.getRun(first)).toMatchObject({
      coordinator_handle: null,
      coordinator_pane_key: null
    })
    expect(
      f.db.getCurrentRunForCoordinator({
        terminalHandle: 'user-terminal',
        paneKey: 'user-pane',
        orcaSessionId: null
      })?.id
    ).toBe(user.id)
    for (const runId of [first, second]) {
      expect(
        (await f.call('manager.runShow', { serviceToken: f.credential.token, runId })).ok
      ).toBe(true)
    }
    expect(
      await f.call('manager.runShow', { serviceToken: f.credential.token, runId: user.id })
    ).toMatchObject({ ok: false, error: { code: 'manager_forbidden' } })
  })

  it('replays a lost response without creating a second Run and rejects changed request input', async () => {
    const f = fixture()
    const first = await f.runCreate()
    expect(await f.runCreate()).toEqual(first)
    expect(f.db.db.prepare('SELECT run_id FROM manager_run_ownership').all()).toHaveLength(1)
    expect(await f.runCreate({ objective: 'Changed' })).toMatchObject({
      ok: false,
      error: { code: 'request_mismatch' }
    })
  })

  it.each([
    { ...grant, scope: { ...grant.scope, executionHostIds: ['ssh:other'] } },
    { ...grant, scope: { ...grant.scope, projectIds: [] } },
    { ...grant, actions: ['inventory:read'] }
  ] satisfies ManagerPrincipalGrant[])(
    'refuses an ungranted host, project or action',
    async (restricted) => {
      const f = fixture(restricted)
      expect(await f.runCreate()).toMatchObject({ ok: false, error: { code: 'manager_forbidden' } })
      expect(f.db.db.prepare('SELECT id FROM runs WHERE legacy = 0').all()).toEqual([])
    }
  )

  it('rechecks the lease after async workspace resolution, before any receipt or Run write', async () => {
    const f = fixture()
    vi.mocked(f.runtime.showTerminalWorkspaceLaunchScope).mockImplementation(async () => {
      f.db.managerPrincipals.release(f.lease)
      return { id: workspaceId, path: '/repo', connectionId: 'worker', repo, folderWorkspace: null }
    })
    expect(await f.runCreate()).toMatchObject({
      ok: false,
      error: { code: 'manager_consumer_fenced' }
    })
    expect(f.db.db.prepare('SELECT id FROM runs WHERE legacy = 0').all()).toEqual([])
    expect(f.db.db.prepare('SELECT request_id FROM mutation_receipts').all()).toEqual([])
  })

  it('adds only owned Runs to event scope and retains project/host restrictions', async () => {
    const f = fixture()
    const created = await f.runCreate()
    if (!created.ok) {
      throw new Error('create failed')
    }
    const runId = runResult.parse(created.result).run.id
    const other = f.db.createRun({
      objective: 'Other',
      coordinatorHandle: null,
      coordinatorPaneKey: null
    })
    for (const [id, run, projectId] of [
      ['owned', runId, grant.scope.projectIds[0]],
      ['unowned', other.id, grant.scope.projectIds[0]],
      ['wrong-project', runId, 'private-project']
    ]) {
      f.db.managerEvents.append({
        eventId: id,
        source: 'hook',
        sourceGeneration: 'one',
        kind: 'question',
        occurredAt: 1,
        summary: id,
        scope: { executionHostId: 'ssh:worker', projectId, runId: run, actor: 'worker' }
      })
    }
    const result = await f.call('manager.eventsRead', { serviceToken: f.credential.token })
    expect(JSON.stringify(result)).toContain('owned')
    expect(JSON.stringify(result)).not.toContain('unowned')
    expect(JSON.stringify(result)).not.toContain('wrong-project')
  })

  it('rolls back Run, ownership and receipt together when a nested creation step fails', async () => {
    const f = fixture()
    vi.spyOn(f.db.managerRuns, 'registerCreatedRun').mockImplementationOnce(() => {
      throw new Error('Injected ownership failure')
    })
    expect((await f.runCreate()).ok).toBe(false)
    expect(f.db.db.prepare('SELECT id FROM runs WHERE legacy = 0').all()).toEqual([])
    expect(f.db.db.prepare('SELECT run_id FROM manager_run_ownership').all()).toEqual([])
    expect(f.db.db.prepare('SELECT request_id FROM mutation_receipts').all()).toEqual([])
    expect((await f.runCreate()).ok).toBe(true)
  })

  it('fences service authority if a user subsequently takes over the Run', async () => {
    const f = fixture()
    const created = await f.runCreate()
    if (!created.ok) {
      throw new Error('create failed')
    }
    const runId = runResult.parse(created.result).run.id
    f.db.db
      .prepare('UPDATE runs SET consumer_generation = consumer_generation + 1 WHERE id = ?')
      .run(runId)
    expect(
      await f.call('manager.runShow', { serviceToken: f.credential.token, runId })
    ).toMatchObject({ ok: false, error: { code: 'manager_consumer_fenced' } })
    expect(
      f.db.managerRuns.observationGrant(f.credential.principal.id, grant.scope).runIds
    ).toEqual([])
  })

  it('supports folder workspaces by their real group without inventing a repository', async () => {
    const f = fixture({
      ...grant,
      scope: { ...grant.scope, projectIds: [], projectGroupIds: ['group'] }
    })
    const folder: FolderWorkspace = {
      id: 'folder',
      projectGroupId: 'group',
      name: 'Folder',
      folderPath: '/folder',
      connectionId: 'worker',
      linkedTask: null,
      comment: '',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 1,
      createdAt: 1,
      updatedAt: 1
    }
    vi.mocked(f.runtime.listFolderWorkspaces).mockReturnValue([folder])
    vi.mocked(f.runtime.showTerminalWorkspaceLaunchScope).mockResolvedValue({
      id: 'folder:folder',
      path: '/folder',
      connectionId: 'worker',
      repo: null,
      folderWorkspace: folder
    })
    expect(await f.runCreate({ workspaceId: 'folder:folder' })).toMatchObject({
      ok: true,
      result: { scope: { projectGroupId: 'group', workspaceId: 'folder:folder' } }
    })
  })
})

describe('manager Task creation', () => {
  it('uses existing Task rows with atomic receipts and rejects dependencies from another Run', async () => {
    const f = fixture()
    const created = await f.runCreate()
    if (!created.ok) {
      throw new Error('create failed')
    }
    const runId = runResult.parse(created.result).run.id
    const params = {
      serviceToken: f.credential.token,
      lease: f.lease,
      requestId: 'task-one',
      runId,
      spec: 'Build'
    }
    const one = await f.call('manager.taskCreate', params)
    expect(one).toMatchObject({ ok: true, result: { task: { run_id: runId, status: 'ready' } } })
    expect(await f.call('manager.taskCreate', params)).toEqual(one)
    expect(f.db.listTasks({ runId })).toHaveLength(1)
    const otherRun = f.db.createRun({
      objective: 'Other',
      coordinatorHandle: null,
      coordinatorPaneKey: null
    })
    const otherTask = f.db.createTask({ runId: otherRun.id, spec: 'Other' })
    expect(
      (
        await f.call('manager.taskCreate', {
          ...params,
          requestId: 'bad-dep',
          deps: [otherTask.id]
        })
      ).ok
    ).toBe(false)
    expect(
      f.db.getMutationReceipt(`manager:${f.credential.principal.id}`, 'bad-dep')
    ).toBeUndefined()
    expect(f.db.listTasks({ runId })).toHaveLength(1)
  })

  it('an explicit observer grant does not confer ownership or allow adopting a user Run', async () => {
    const f = fixture()
    const user = f.db.createRun({
      objective: 'User',
      coordinatorHandle: 'user',
      coordinatorPaneKey: 'pane'
    })
    const observer = f.db.managerPrincipals.issue(
      'Observer',
      {
        ...grant,
        scope: { ...grant.scope, runIds: [user.id] }
      },
      Date.now() + 120_000
    )
    const lease = f.db.managerPrincipals.claim(observer.principal.id, 'other-adapter')
    expect(
      await f.call('manager.taskCreate', {
        serviceToken: observer.token,
        lease,
        requestId: 'adopt',
        runId: user.id,
        spec: 'Unauthorized'
      })
    ).toMatchObject({ ok: false, error: { code: 'manager_forbidden' } })
    expect(f.db.listTasks({ runId: user.id })).toEqual([])
  })
})
