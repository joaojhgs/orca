import { beforeEach, describe, expect, it, vi } from 'vitest'

const { callEnvironmentEnvelope, assertActiveEnvironment } = vi.hoisted(() => ({
  callEnvironmentEnvelope: vi.fn(),
  assertActiveEnvironment: vi.fn()
}))
vi.mock('../runtime/client/web-runtime-calls', () => ({ callEnvironmentEnvelope }))
vi.mock('../runtime/client/web-runtime-session', () => ({
  assertActiveEnvironment,
  requireActiveEnvironment: () => ({ id: 'paired', createdAt: 1, pairingRevision: 2 })
}))
import { createWebMobileApi } from './host-capabilities/web-mobile-api'

const status = (capabilities: string[]) => ({
  ok: true,
  result: { capabilities, runtimeId: 'runtime-one' }
})

beforeEach(() => {
  callEnvironmentEnvelope
    .mockReset()
    .mockImplementation((_owner, method) =>
      Promise.resolve(
        method === 'status.get' ? status(['pairing.administration.v1']) : { ok: true, result: {} }
      )
    )
  assertActiveEnvironment.mockReset()
})

describe('browser mobile pairing API', () => {
  it('pins pairing operations to the server whose capability was checked', async () => {
    const { mobile } = createWebMobileApi()
    await mobile.getPairingQR({ connectionMode: 'local-only', rotate: true })
    expect(callEnvironmentEnvelope.mock.calls).toEqual([
      ['paired', 'status.get', undefined, 15000, 2],
      [
        'paired',
        'pairing.admin.getPairingQR',
        { connectionMode: 'local-only', rotate: true },
        undefined,
        2,
        'runtime-one'
      ]
    ])
    expect(assertActiveEnvironment).toHaveBeenCalledWith('paired')
  })

  it('does not fabricate a pairing inventory on older hosts', async () => {
    callEnvironmentEnvelope.mockResolvedValueOnce(status([]))
    const { mobile } = createWebMobileApi()
    await expect(mobile.listDevices()).rejects.toThrow('Update the Orca server')
    expect(callEnvironmentEnvelope).toHaveBeenCalledTimes(1)
  })

  it('refuses revocation if the paired server changed after the probe', async () => {
    assertActiveEnvironment.mockImplementation(() => {
      throw new Error('Paired server changed')
    })
    const { mobile } = createWebMobileApi()
    await expect(mobile.revokeRuntimeAccess({ deviceId: 'browser' })).rejects.toThrow(
      'Paired server changed'
    )
    expect(callEnvironmentEnvelope).toHaveBeenCalledTimes(1)
  })
})
