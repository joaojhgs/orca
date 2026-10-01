import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyRateLimitState } from '../../../../shared/rate-limit-state-factory'
import { createRateLimitsApi } from './web-rate-limits-api'
import { callRuntimeResult } from './web-runtime-calls'

vi.mock('./web-runtime-calls', () => ({ callRuntimeResult: vi.fn() }))
vi.mock('./web-runtime-session', () => ({ requireActiveEnvironmentOrNull: () => ({ id: 'host' }) }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('browser host usage tracking', () => {
  it('reads all provider data from the host without forcing provider requests', async () => {
    const state = createEmptyRateLimitState()
    vi.mocked(callRuntimeResult).mockResolvedValue({ rateLimits: state })
    expect(await createRateLimitsApi().get()).toBe(state)
    expect(callRuntimeResult).toHaveBeenLastCalledWith(
      'accounts.list',
      { refreshUsage: false },
      60_000
    )
  })
  it('uses stale-aware polling, pauses in hidden tabs and stops after unsubscribe', async () => {
    vi.useFakeTimers()
    const document = { visibilityState: 'visible' }
    vi.stubGlobal('document', document)
    const state = createEmptyRateLimitState()
    vi.mocked(callRuntimeResult).mockClear().mockResolvedValue({ rateLimits: state })
    const listener = vi.fn()
    const stop = createRateLimitsApi().onUpdate(listener)
    await vi.advanceTimersByTimeAsync(1)
    expect(listener).toHaveBeenCalledWith(state)
    expect(callRuntimeResult).toHaveBeenLastCalledWith('accounts.usage', undefined, 60_000)
    document.visibilityState = 'hidden'
    const count = vi.mocked(callRuntimeResult).mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(callRuntimeResult).toHaveBeenCalledTimes(count)
    stop()
    document.visibilityState = 'visible'
    await vi.advanceTimersByTimeAsync(60_000)
    expect(callRuntimeResult).toHaveBeenCalledTimes(count)
  })
  it('falls back to cached accounts on old hosts without forced polling', async () => {
    vi.useFakeTimers()
    const state = createEmptyRateLimitState()
    vi.mocked(callRuntimeResult)
      .mockRejectedValueOnce(Object.assign(new Error('old host'), { code: 'method_not_found' }))
      .mockResolvedValue({ rateLimits: state })
    const listener = vi.fn()
    const stop = createRateLimitsApi().onUpdate(listener)
    await vi.advanceTimersByTimeAsync(1)
    expect(listener).toHaveBeenCalledWith(state)
    expect(callRuntimeResult).toHaveBeenLastCalledWith(
      'accounts.list',
      { refreshUsage: false },
      60_000
    )
    stop()
  })
})
