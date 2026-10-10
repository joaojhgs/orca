import { describe, expect, it } from 'vitest'
import { FakeLogicalClient, FakeSession } from '../transport/mobile-endpoint-supervisor-test-fakes'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import {
  mobileManagerCall,
  mobileManagerConnectionKey,
  MobileManagerRefusalError
} from './mobile-manager-call'

describe('native owner manager RPC admission', () => {
  it('decodes a named owner conversation operation with checked params', async () => {
    const client = new FakeSession('connected')
    client.sendRequest.mockResolvedValue({
      id: 'reply',
      ok: true,
      result: { principals: [], nextOffset: null }
    })
    expect(await mobileManagerCall(client, () => true)('manager.principalsList', {})).toEqual({
      principals: [],
      nextOffset: null
    })
    expect(client.sendRequest).toHaveBeenCalledWith('manager.principalsList', {
      offset: 0,
      limit: 50
    })
  })

  it('refuses service/admin methods and credential-bearing owner params before transmission', async () => {
    const client = new FakeSession('connected')
    const call = mobileManagerCall(client, () => true)
    await expect(call('manager.principalIssue', {})).rejects.toThrow('Unsupported')
    await expect(call('manager.conversationPost', {})).rejects.toThrow('Unsupported')
    await expect(
      call('manager.conversationSend', {
        requestId: 'request',
        runId: 'run',
        body: 'message',
        serviceToken: 'token'
      })
    ).rejects.toThrow()
    expect(client.sendRequest).not.toHaveBeenCalled()
  })

  it('distinguishes a definite old-server refusal from unknown delivery', async () => {
    const client = new FakeSession('connected')
    client.sendRequest.mockResolvedValue({
      id: 'reply',
      ok: false,
      error: { code: 'unknown_method', message: 'Old server' }
    })
    await expect(
      mobileManagerCall(client, () => true)('manager.conversationsList', {})
    ).rejects.toMatchObject({ code: 'unknown_method', name: 'MobileManagerRefusalError' })
    const unknown = markRpcDeliveryUnknown(new Error('reply lost'))
    client.sendRequest.mockRejectedValueOnce(unknown)
    await expect(
      mobileManagerCall(client, () => true)('manager.conversationsList', {})
    ).rejects.toBe(unknown)
    expect(unknown).not.toBeInstanceOf(MobileManagerRefusalError)
  })

  it('never accepts undefined or malformed mutation acknowledgements', async () => {
    const client = new FakeSession('connected')
    const call = mobileManagerCall(client, () => true)
    for (const result of [
      undefined,
      { accepted: true },
      { messageId: 'id', accepted: true, delivery: 'started' }
    ]) {
      client.sendRequest.mockResolvedValue({ id: 'reply', ok: true, result })
      await expect(
        call('manager.conversationSend', { requestId: 'request', runId: 'run', body: 'hello' })
      ).rejects.toThrow()
    }
  })

  it('does not dispatch after controller replacement or disconnection', async () => {
    const client = new FakeSession('connected')
    await expect(
      mobileManagerCall(client, () => false)('manager.principalsList', {})
    ).rejects.toThrow('Controller connection changed')
    client.publishState('disconnected')
    await expect(
      mobileManagerCall(client, () => true)('manager.principalsList', {})
    ).rejects.toThrow('Controller connection changed')
    expect(client.sendRequest).not.toHaveBeenCalled()
  })

  it('rejects an old generation response and keys a replacement surface separately', async () => {
    const client = new FakeLogicalClient('connected', 'lan')
    const call = mobileManagerCall(client, () => true)
    const firstKey = mobileManagerConnectionKey(client, 'hashed-owner')
    client.sendRequest.mockImplementationOnce(async () => {
      await client.migrateTo(new FakeSession('connected'), 'relay')
      return { id: 'reply', ok: true, result: { principals: [], nextOffset: null } }
    })
    await expect(call('manager.principalsList', {})).rejects.toThrow(
      'Controller connection changed'
    )
    expect(mobileManagerConnectionKey(client, 'hashed-owner')).not.toBe(firstKey)
    await expect(call('manager.principalsList', {})).rejects.toThrow(
      'Controller connection changed'
    )
    expect(client.sendRequest).toHaveBeenCalledTimes(1)
    expect(mobileManagerConnectionKey(new FakeSession('connected'), 'hashed-owner')).not.toBe(
      firstKey
    )
  })
})
