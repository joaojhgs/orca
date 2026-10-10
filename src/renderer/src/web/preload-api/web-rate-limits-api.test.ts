import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyRateLimitState } from '../../../../shared/rate-limit-state-factory'
import { createRateLimitsApi, fetchAccountsSnapshot } from './web-rate-limits-api'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'

const mocks = vi.hoisted(() => ({ call: vi.fn(), subscribe: vi.fn(), owner: 'one' }))
vi.mock('./web-runtime-calls', () => ({ callRuntimeResult: mocks.call }))
vi.mock('./web-runtime-session', () => ({
  requireActiveEnvironmentOrNull: () => ({ id: mocks.owner, createdAt: 1 }),
  getClientForEnvironment: () => ({ subscribe: mocks.subscribe })
}))

describe('browser host usage tracking', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.owner = 'one'
  })
  afterEach(() => vi.useRealTimers())

  it('reads aggregated usage without forcing provider requests', async () => {
    const state = createEmptyRateLimitState()
    mocks.call.mockResolvedValue({ rateLimits: state })
    expect(await createRateLimitsApi().get()).toBe(state)
    expect(mocks.call).toHaveBeenLastCalledWith('accounts.list', { refreshUsage: false }, 60_000)
  })

  it('uses the server stream and unsubscribes when its last reader leaves', async () => {
    const state = createEmptyRateLimitState()
    const unsubscribe = vi.fn()
    let receive: (response: RuntimeRpcResponse<unknown>) => void = () => {}
    mocks.subscribe.mockImplementation((_method, _params, callbacks) => {
      receive = callbacks.onResponse
      return Promise.resolve({ unsubscribe })
    })
    const listener = vi.fn()
    const stop = createRateLimitsApi().onUpdate(listener)
    await vi.waitFor(() => expect(mocks.subscribe).toHaveBeenCalledTimes(1))
    receive({
      id: 'usage',
      ok: true,
      result: { snapshot: { rateLimits: state } },
      _meta: { runtimeId: 'one' }
    })
    expect(listener).toHaveBeenCalledWith(state)
    stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('rejects a snapshot from an environment replaced during the request', async () => {
    mocks.call.mockImplementation(async () => {
      mocks.owner = 'two'
      return { rateLimits: createEmptyRateLimitState() }
    })
    await expect(fetchAccountsSnapshot(false)).rejects.toThrow('paired Orca server changed')
  })

  it('ignores stream frames from a previous owner and does not reuse its cache', async () => {
    const state = createEmptyRateLimitState({
      inactiveCodexAccounts: [
        {
          accountId: 'old-owner',
          rateLimits: null,
          updatedAt: 0,
          isFetching: false
        }
      ]
    })
    let receive: (response: RuntimeRpcResponse<unknown>) => void = () => {}
    mocks.subscribe.mockImplementation((_method, _params, callbacks) => {
      receive = callbacks.onResponse
      return Promise.resolve({ unsubscribe: vi.fn() })
    })
    const listener = vi.fn()
    const stop = createRateLimitsApi().onUpdate(listener)
    await vi.waitFor(() => expect(mocks.subscribe).toHaveBeenCalledTimes(1))
    mocks.owner = 'two'
    receive({
      id: 'usage',
      ok: true,
      result: { snapshot: { rateLimits: state } },
      _meta: { runtimeId: 'one' }
    })
    expect(listener).not.toHaveBeenCalled()
    mocks.call.mockRejectedValue(new Error('offline'))
    expect(await createRateLimitsApi().get()).toEqual(createEmptyRateLimitState())
    stop()
  })
})
