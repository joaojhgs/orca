import { describe, expect, it } from 'vitest'
import { FakeLogicalClient, FakeSession } from '../transport/mobile-endpoint-supervisor-test-fakes'
import { mobileNotificationPolicyCall } from './mobile-notification-policy-operations'

const receipt = { policy: { rules: [], deviceOverrides: [] }, revision: 'a'.repeat(64) }
describe('native server notification policy operations', () => {
  it('uses checked server receipts and the server revision for writes', async () => {
    const client = new FakeSession('connected')
    client.sendRequest.mockResolvedValue({ id: 'reply', ok: true, result: receipt })
    const call = mobileNotificationPolicyCall(client, () => true)
    expect(await call.read()).toEqual(receipt)
    expect(await call.update(receipt.policy, receipt.revision)).toEqual(receipt)
    expect(client.sendRequest).toHaveBeenLastCalledWith(
      'notifications.policyUpdate',
      { policy: receipt.policy, expectedRevision: receipt.revision },
      { timeoutMs: 20000, failWhenDisconnected: true }
    )
  })

  it('does not interpret a response from the previous controller generation', async () => {
    const client = new FakeLogicalClient('connected', 'lan')
    client.sendRequest.mockImplementationOnce(async () => {
      await client.migrateTo(new FakeSession('connected'), 'relay')
      return { id: 'reply', ok: true, result: receipt }
    })
    const call = mobileNotificationPolicyCall(client, () => true)
    await expect(call.read()).rejects.toThrow('Server connection changed')
    await expect(call.update(receipt.policy, receipt.revision)).rejects.toThrow(
      'Server connection changed'
    )
    expect(client.sendRequest).toHaveBeenCalledTimes(1)
  })

  it('refuses old, disconnected and unowned servers without fallback or transmission', async () => {
    const client = new FakeSession('connected')
    await expect(mobileNotificationPolicyCall(client, () => false).read()).rejects.toThrow(
      'connection changed'
    )
    expect(client.sendRequest).not.toHaveBeenCalled()
    client.sendRequest.mockResolvedValue({
      id: 'reply',
      ok: false,
      error: { code: 'method_not_found', message: 'Old server' }
    })
    await expect(mobileNotificationPolicyCall(client, () => true).read()).rejects.toThrow(
      'Old server'
    )
    client.publishState('disconnected')
    await expect(mobileNotificationPolicyCall(client, () => true).read()).rejects.toThrow(
      'connection changed'
    )
    expect(client.sendRequest).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, { accepted: true }, { ...receipt, revision: 'invalid' }])(
    'never treats a malformed save acknowledgement as success: %j',
    async (result) => {
      const client = new FakeSession('connected')
      client.sendRequest.mockResolvedValue({ id: 'reply', ok: true, result })
      await expect(
        mobileNotificationPolicyCall(client, () => true).update(receipt.policy, receipt.revision)
      ).rejects.toThrow()
    }
  )
})
