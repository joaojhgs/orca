import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { OrchestrationDb } from '../../orchestration/db'
import { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { MANAGER_METHODS } from './manager'
import type { RpcCallerScope } from '../rpc-caller-scope'
import { ManagerConsumerLeaseSchema } from '../../../../shared/manager-principal-contract'
import { ManagerEventCursorSchema } from '../../../../shared/manager-event-contract'

const databases: OrchestrationDb[] = []
const grant = {
  scope: { executionHostIds: ['ssh:worker'], projectIds: ['project'], runIds: [] },
  actions: ['events:read', 'events:checkpoint'] as const
}
function fixture(scope: RpcCallerScope = { kind: 'owner' }) {
  const db = new OrchestrationDb(':memory:')
  databases.push(db)
  const runtime = new OrcaRuntimeService()
  runtime.setOrchestrationDb(db)
  const dispatcher = new RpcDispatcher({ runtime, methods: MANAGER_METHODS, callerScope: scope })
  const call = (method: string, params: unknown) =>
    dispatcher.dispatch({
      id: 'request',
      authToken: 'transport-attested',
      method,
      params
    })
  return { db, call }
}
afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close()
  }
})
describe('manager RPC authority', () => {
  it('lets an owner issue explicit grants but an SSH worker cannot issue or revoke authority', async () => {
    const params = {
      label: 'Hermes',
      grant: { ...grant, actions: [...grant.actions] },
      expiresAt: Date.now() + 60_000
    }
    expect((await fixture().call('manager.issue', params)).ok).toBe(true)
    const worker = fixture({ kind: 'ssh-bridge', targetId: 'worker', remoteCliControl: true })
    expect(await worker.call('manager.issue', params)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' }
    })
    expect(await worker.call('manager.revoke', { principalId: 'guess' })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' }
    })
  })
  it('requires a separate service credential even on an authorized workspace transport', async () => {
    const f = fixture({ kind: 'ssh-bridge', targetId: 'worker', remoteCliControl: true })
    expect(
      await f.call('manager.eventsRead', { serviceToken: `orcam_${'a'.repeat(43)}` })
    ).toMatchObject({ ok: false, error: { code: 'manager_unauthorized' } })
    const issued = f.db.managerPrincipals.issue(
      'Hermes',
      { ...grant, actions: [...grant.actions] },
      Date.now() + 60_000
    )
    f.db.managerEvents.append({
      eventId: 'visible',
      source: 'hook',
      sourceGeneration: 'one',
      kind: 'question',
      scope: { executionHostId: 'ssh:worker', projectId: 'project', actor: 'worker' },
      occurredAt: 1,
      summary: 'question'
    })
    f.db.managerEvents.append({
      eventId: 'hidden',
      source: 'hook',
      sourceGeneration: 'one',
      kind: 'question',
      scope: { executionHostId: 'ssh:worker', projectId: 'other', actor: 'worker' },
      occurredAt: 1,
      summary: 'private'
    })
    const response = await f.call('manager.eventsRead', { serviceToken: issued.token })
    expect(response.ok).toBe(true)
    expect(JSON.stringify(response)).toContain('visible')
    expect(JSON.stringify(response)).not.toContain('hidden')
    expect(JSON.stringify(response)).not.toContain(issued.token)
  })
  it('cannot checkpoint another principal or a fenced generation', async () => {
    const f = fixture()
    const a = f.db.managerPrincipals.issue(
      'A',
      { ...grant, actions: [...grant.actions] },
      Date.now() + 60_000
    )
    const b = f.db.managerPrincipals.issue(
      'B',
      { ...grant, actions: [...grant.actions] },
      Date.now() + 60_000
    )
    const claimed = await f.call('manager.consumerClaim', {
      serviceToken: a.token,
      consumerId: 'adapter'
    })
    if (!claimed.ok) {
      throw new Error('claim failed')
    }
    const lease = z.object({ lease: ManagerConsumerLeaseSchema }).parse(claimed.result).lease
    const cursor = ManagerEventCursorSchema.parse(f.db.managerEvents.read(grant.scope).cursor)
    expect(
      await f.call('manager.eventsCheckpoint', { serviceToken: b.token, lease, cursor })
    ).toMatchObject({ ok: false, error: { code: 'manager_unauthorized' } })
    f.db.managerPrincipals.release(lease)
    expect(
      await f.call('manager.eventsCheckpoint', { serviceToken: a.token, lease, cursor })
    ).toMatchObject({ ok: false, error: { code: 'manager_consumer_fenced' } })
    expect(f.db.managerEvents.getCheckpoint(a.principal.id)).toBeNull()
  })
})
