import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { z } from 'zod'
import { Store } from '../../../persistence/loading-store/store'
import { closeTestStores, createSqliteTestStore } from '../../../persistence-test-harness'
import { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import type { RpcCallerScope } from '../rpc-caller-scope'
import { NOTIFICATION_METHODS } from './notifications'

const directories: string[] = []
afterEach(async () => {
  await closeTestStores()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})
const snapshot = z.object({ revision: z.string(), policy: z.unknown() })
it('persists paired-browser policy on the server and rejects a stale edit after a fresh disk read', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-notification-policy-'))
  directories.push(directory)
  const dataFile = join(directory, 'orca-data.json')
  const store = createSqliteTestStore(Store, { dataFile })
  const runtime = new OrcaRuntimeService(store)
  const dispatcher = new RpcDispatcher({
    runtime,
    methods: NOTIFICATION_METHODS,
    callerScope: { kind: 'runtime-paired', grants: [] }
  })
  const call = (method: string, params: unknown = undefined) =>
    dispatcher.dispatch({ id: 'req', authToken: 'attested', method, params })
  const before = await call('notifications.policyRead')
  if (!before.ok) {
    throw new Error('Server policy read failed')
  }
  const first = snapshot.parse(before.result)
  const ordinary = store.getSettings().notifications
  const policy = {
    rules: [
      { id: 'project-off', selector: { level: 'project', id: 'project' }, human: { mode: 'off' } }
    ],
    deviceOverrides: [{ deviceId: 'phone', mutedEvents: ['progress'] }]
  }
  expect(
    await call('notifications.policyUpdate', { policy, expectedRevision: first.revision })
  ).toMatchObject({ ok: true, result: { policy } })
  const reloaded = createSqliteTestStore(Store, { dataFile })
  expect(reloaded.getSettings().notifications).toEqual({ ...ordinary, scopePolicy: policy })
  expect(
    await call('notifications.policyUpdate', {
      policy: { rules: [], deviceOverrides: [] },
      expectedRevision: first.revision
    })
  ).toMatchObject({ ok: false })
  expect(runtime.getNotificationPolicy().policy).toEqual(policy)
})
it.each<RpcCallerScope>([
  { kind: 'ssh-bridge', targetId: 'worker', remoteCliControl: true },
  { kind: 'manager-service', principalId: 'manager' }
])('refuses a non-owner agent changing human notification policy: $kind', async (callerScope) => {
  const dispatcher = new RpcDispatcher({
    runtime: new OrcaRuntimeService(),
    methods: NOTIFICATION_METHODS,
    callerScope
  })
  expect(
    await dispatcher.dispatch({
      id: 'req',
      authToken: 'attested',
      method: 'notifications.policyRead'
    })
  ).toMatchObject({ ok: false, error: { code: 'forbidden' } })
})
