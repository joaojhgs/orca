import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../runtime/client/web-runtime-calls', () => ({ callRuntimeResult: mocks.call }))
vi.mock('../runtime/client/web-runtime-session', () => ({
  requireActiveEnvironment: () => ({ id: 'host-one', createdAt: 1 })
}))
import { createWebUsageAnalyticsApi } from './web-usage-analytics-api'

describe('Usage Tracking browser APIs', () => {
  beforeEach(() => vi.clearAllMocks())
  it.each([
    ['claudeUsage', 'claude'],
    ['codexUsage', 'codex'],
    ['openCodeUsage', 'opencode'],
    ['museUsage', 'muse']
  ] as const)('provides working %s APIs instead of undefined stubs', async (key, provider) => {
    const api = createWebUsageAnalyticsApi()[key]
    const state = { enabled: true, isScanning: false }
    mocks.call.mockImplementation((method: string) =>
      method === 'usage.call'
        ? Promise.reject(Object.assign(new Error('Unknown method'), { code: 'method_not_found' }))
        : Promise.resolve(state)
    )
    expect(await api.getScanState()).toBe(state)
    expect(mocks.call).toHaveBeenLastCalledWith(
      'usage.analytics',
      {
        provider,
        operation: 'getScanState'
      },
      undefined
    )
    await api.setEnabled({ enabled: false })
    expect(mocks.call).toHaveBeenLastCalledWith(
      'usage.analytics',
      {
        provider,
        operation: 'setEnabled',
        enabled: false
      },
      undefined
    )
    await api.getSnapshot({ scope: 'all', range: '30d', limit: 10 })
    expect(mocks.call).toHaveBeenLastCalledWith(
      'usage.analytics',
      {
        provider,
        operation: 'getSnapshot',
        scope: 'all',
        range: '30d',
        limit: 10
      },
      undefined
    )
  })
  it('does not turn a disconnected server into fabricated empty usage', async () => {
    mocks.call.mockRejectedValue(new Error('Disconnected'))
    await expect(createWebUsageAnalyticsApi().codexUsage.getScanState()).rejects.toThrow(
      'Disconnected'
    )
  })
})
