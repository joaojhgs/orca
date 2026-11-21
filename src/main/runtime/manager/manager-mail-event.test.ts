import { afterEach, expect, it } from 'vitest'
import {
  fixture,
  cleanupManagerFixtures,
  runResult,
  workspaceId
} from '../rpc/methods/manager-work.test-support'
import { managerWorkspaceScope } from './manager-hook-scope'
import { runLifecycleWriteTransaction } from '../orchestration/db/lifecycle-write-transaction-runner'

afterEach(cleanupManagerFixtures)
it('commits worker mail with its wake, skips own guidance/heartbeats, and rolls both back together', async () => {
  const f = fixture()
  const created = await f.runCreate()
  if (!created.ok) {
    throw new Error('Run creation failed')
  }
  const runId = runResult.parse(created.result).run.id
  const started = f.db.createStartingWorkerDispatch({
    creator: { kind: 'system' },
    maxDepth: 2,
    taskRunId: runId,
    taskSpec: 'Work',
    startOptions: {
      managerScope: managerWorkspaceScope(workspaceId, 'ssh:worker', f.runtime.listRepos(), [])
    }
  })
  const message = {
    from: `dispatch:${started.dispatch.id}`,
    to: `run:${runId}`,
    runId,
    subject: 'Need evidence review',
    body: 'Untrusted worker report'
  }
  f.db.insertMessage(message)
  f.db.insertMessage({ ...message, type: 'heartbeat' })
  f.db.insertMessage({ ...message, from: `run:${runId}`, to: `dispatch:${started.dispatch.id}` })
  const grant = f.db.managerRuns.observationGrant(
    f.credential.principal.id,
    f.credential.principal.grant.scope
  )
  expect(f.db.managerEvents.read(grant).events).toMatchObject([
    { kind: 'mail', scope: { runId, dispatchId: started.dispatch.id, actor: 'worker' } }
  ])
  expect(() =>
    runLifecycleWriteTransaction(f.db.db, 'test_mail_rollback', () => {
      f.db.insertMessage({ ...message, id: 'rollback-message' })
      throw new Error('Rollback source transaction')
    })
  ).toThrow('Rollback source')
  expect(f.db.getMessageById('rollback-message')).toBeUndefined()
  expect(f.db.managerEvents.read(grant).events).toHaveLength(1)
})
