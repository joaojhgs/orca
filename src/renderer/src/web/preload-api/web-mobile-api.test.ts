import { beforeEach, describe, expect, it, vi } from 'vitest'

const { callRuntimeResult, getRemoteRuntimeStatus } = vi.hoisted(() => ({
  callRuntimeResult: vi.fn(),
  getRemoteRuntimeStatus: vi.fn()
}))
vi.mock('./web-runtime-calls', () => ({ callRuntimeResult, getRemoteRuntimeStatus }))
import { createWebMobileApi } from './web-mobile-api'

beforeEach(() => {
  callRuntimeResult.mockReset()
  getRemoteRuntimeStatus.mockReset().mockResolvedValue({
    capabilities: ['pairing.administration.v1']
  })
})

describe('browser mobile pairing API', () => {
  it('uses the active authenticated server for interfaces, QR, and readiness', async () => {
    const api = createWebMobileApi().mobile!
    callRuntimeResult.mockResolvedValue({ interfaces: [{ address: 'wss://orca.example.com' }] })
    expect(await api.listNetworkInterfaces()).toMatchObject({ interfaces: [expect.anything()] })
    expect(callRuntimeResult).toHaveBeenLastCalledWith(
      'pairing.admin.listNetworkInterfaces',
      undefined
    )
    callRuntimeResult.mockResolvedValue({ available: true, endpoint: 'wss://orca.example.com' })
    await api.getPairingQR({ connectionMode: 'local-only', rotate: true })
    expect(callRuntimeResult).toHaveBeenLastCalledWith('pairing.admin.getPairingQR', {
      connectionMode: 'local-only',
      rotate: true
    })
    callRuntimeResult.mockResolvedValue({ ready: false, endpoint: null })
    expect(await api.isWebSocketReady()).toEqual({ ready: false, endpoint: null })
  })

  it('does not manufacture empty inventories or a dead-listener error on older hosts', async () => {
    getRemoteRuntimeStatus.mockResolvedValue({ capabilities: [] })
    const api = createWebMobileApi().mobile!
    await expect(api.getPairingQR()).rejects.toThrow('Update the Orca server')
    await expect(api.listNetworkInterfaces()).rejects.toThrow('Update the Orca server')
    expect(callRuntimeResult).not.toHaveBeenCalled()
  })

  it('forwards list and revocation operations without local mutation', async () => {
    const api = createWebMobileApi().mobile!
    await api.listDevices()
    expect(callRuntimeResult).toHaveBeenLastCalledWith('pairing.admin.listDevices', undefined)
    await api.revokeDevice({ deviceId: 'phone' })
    expect(callRuntimeResult).toHaveBeenLastCalledWith('pairing.admin.revokeDevice', {
      deviceId: 'phone'
    })
    await api.listRuntimeAccessGrants()
    expect(callRuntimeResult).toHaveBeenLastCalledWith(
      'pairing.admin.listRuntimeAccessGrants',
      undefined
    )
    await api.revokeRuntimeAccess({ deviceId: 'browser' })
    expect(callRuntimeResult).toHaveBeenLastCalledWith('pairing.admin.revokeRuntimeAccess', {
      deviceId: 'browser'
    })
  })
})
