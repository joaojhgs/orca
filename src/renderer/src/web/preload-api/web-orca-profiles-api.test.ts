import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWebOrcaProfilesApi } from './web-orca-profiles-api'
import { callRuntimeResult } from './web-runtime-calls'

vi.mock('./web-runtime-calls', () => ({ callRuntimeResult: vi.fn() }))
beforeEach(() => {
  vi.mocked(callRuntimeResult).mockReset()
})

describe('browser artifact host account status', () => {
  it('reports the host account instead of claiming browser sign-in is unavailable', async () => {
    const status = {
      activeProfileId: 'host-profile',
      configured: true,
      state: 'connected',
      persistence: 'encrypted'
    }
    vi.mocked(callRuntimeResult).mockResolvedValue(status)
    expect(await createWebOrcaProfilesApi().orcaProfiles?.authStatus()).toBe(status)
    expect(callRuntimeResult).toHaveBeenCalledWith('artifacts.authStatus')
  })
  it('degrades safely on old hosts', async () => {
    vi.mocked(callRuntimeResult).mockRejectedValue(
      Object.assign(new Error('old host'), { code: 'method_not_found' })
    )
    expect(await createWebOrcaProfilesApi().orcaProfiles?.authStatus()).toMatchObject({
      configured: false,
      state: 'unconfigured'
    })
  })
  it('does not disguise authorization or connection failures as signed-out state', async () => {
    vi.mocked(callRuntimeResult).mockRejectedValue(
      Object.assign(new Error('revoked'), { code: 'unauthorized' })
    )
    await expect(createWebOrcaProfilesApi().orcaProfiles?.authStatus()).rejects.toThrow('revoked')
  })
})
