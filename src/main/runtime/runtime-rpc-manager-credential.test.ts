import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { OrchestrationDb } from './orchestration/db'
import type { RpcResponse } from './rpc/core'
import { resolveRpcCallerIdentity, rpcCallerOperationKey } from './rpc/rpc-caller-identity'
import { RpcDispatcher } from './rpc/dispatcher'

const fixtures: { db: OrchestrationDb; directory: string }[] = []
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'orca-manager-transport-'))
  const db = new OrchestrationDb(':memory:')
  fixtures.push({ db, directory })
  const runtime = new OrcaRuntimeService()
  runtime.setOrchestrationDb(db)
  const server = new OrcaRuntimeRpcServer({
    runtime,
    userDataPath: directory,
    enableWebSocket: false
  })
  const credential = db.managerPrincipals.issue(
    'Hermes',
    {
      actions: ['events:read'],
      scope: { executionHostIds: ['local'], projectIds: [], runIds: [] }
    },
    Date.now() + 60_000
  )
  const send = (
    method: string,
    params: unknown = {},
    token = credential.token
  ): Promise<RpcResponse> =>
    server['handleMessage'](JSON.stringify({ id: 'request', authToken: token, method, params }))
  return { db, runtime, server, credential, send }
}
afterEach(() => {
  for (const { db, directory } of fixtures.splice(0)) {
    db.close()
    rmSync(directory, { recursive: true })
  }
})

describe('manager service transport credentials', () => {
  it('authenticates the service without any owner token and supplies only its own principal', async () => {
    const f = fixture()
    expect(await f.send('manager.eventsRead')).toMatchObject({ ok: true, result: { events: [] } })
    expect(await f.send('manager.consumerClaim', { consumerId: 'consumer' })).toMatchObject({
      ok: false,
      error: { code: 'manager_forbidden' }
    })
    expect(await f.send('manager.eventsRead', null)).toMatchObject({
      ok: false,
      error: { code: 'bad_request' }
    })
    expect(await f.send('manager.eventsRead', { serviceToken: 'different-token' })).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' }
    })
  })

  it.each([
    'terminal.create',
    'terminal.send',
    'files.read',
    'files.write',
    'orchestration.workerStart',
    'ssh.connect',
    'settings.update',
    'notifications.policyRead',
    'notifications.policyUpdate',
    'notifications.policyTargets',
    'accounts.list',
    'accounts.selectClaude',
    'manager.issue',
    'manager.revoke',
    'pairing.admin.listDevices',
    'manager.unknownFutureMethod'
  ])(
    'refuses %s even though a normal remote CLI could have broader permissions',
    async (method) => {
      expect(await fixture().send(method)).toMatchObject({
        ok: false,
        error: { code: 'forbidden' }
      })
    }
  )

  it('rechecks revocation and rejects invalid service tokens', async () => {
    const f = fixture()
    f.db.managerPrincipals.revoke(f.credential.principal.id)
    expect(await f.send('manager.eventsRead')).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' }
    })
    expect(await f.send('manager.eventsRead', {}, `orcam_${'a'.repeat(43)}`)).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' }
    })
  })

  it('gives service calls a separate operation identity instead of the owner namespace', () => {
    const caller = resolveRpcCallerIdentity({
      callerScope: { kind: 'manager-service', principalId: 'principal-one' },
      caller: { kind: 'local-cli' }
    })
    expect(caller).toEqual({ kind: 'manager-service', principalId: 'principal-one' })
    if (!caller) {
      throw new Error('missing service identity')
    }
    expect(rpcCallerOperationKey(caller)).toBe('manager-service:principal-one')
  })

  it('applies the same method refusal through streaming dispatch', async () => {
    const f = fixture()
    const replies: string[] = []
    await new RpcDispatcher({ runtime: f.runtime }).dispatchStreaming(
      {
        id: 'stream',
        authToken: f.credential.token,
        method: 'terminal.subscribe',
        params: {}
      },
      (reply) => replies.push(reply),
      {
        callerScope: { kind: 'manager-service', principalId: f.credential.principal.id }
      }
    )
    expect(replies).toHaveLength(1)
    expect(JSON.parse(replies[0])).toMatchObject({ ok: false, error: { code: 'forbidden' } })
  })
})
