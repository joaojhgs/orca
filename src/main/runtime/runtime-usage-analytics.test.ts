import { describe, expect, it, vi } from 'vitest'
import { UsageAnalyticsParams } from '../../shared/rpc-contract/usage-analytics-params'
import { controlUsageAnalytics } from './runtime-usage-analytics'

function store() {
  return {
    getScanState: vi.fn(() => ({ enabled: true })),
    setEnabled: vi.fn(),
    refresh: vi.fn(),
    getSnapshot: vi.fn(() => ({ summary: { sessions: 42 } })),
    getSummary: vi.fn(),
    getDaily: vi.fn(),
    getBreakdown: vi.fn(),
    getRecentSessions: vi.fn()
  }
}

describe('browser usage analytics', () => {
  it.each(['claude', 'codex', 'opencode', 'muse'] as const)(
    'routes %s to its existing analytics store',
    (provider) => {
      const stores = { claude: store(), codex: store(), opencode: store(), muse: store() }
      const snapshot = controlUsageAnalytics(stores, {
        provider,
        operation: 'getSnapshot',
        scope: 'all',
        range: '30d',
        limit: 8
      })
      expect(snapshot).toEqual({ summary: { sessions: 42 } })
      expect(stores[provider].getSnapshot).toHaveBeenCalledWith('all', '30d', 8)
      controlUsageAnalytics(stores, { provider, operation: 'setEnabled', enabled: true })
      expect(stores[provider].setEnabled).toHaveBeenCalledWith(true)
      controlUsageAnalytics(stores, { provider, operation: 'refresh' })
      expect(stores[provider].refresh).toHaveBeenCalledWith(false)
      controlUsageAnalytics(stores, {
        provider,
        operation: 'getBreakdown',
        scope: 'orca',
        range: '7d',
        kind: 'project'
      })
      expect(stores[provider].getBreakdown).toHaveBeenCalledWith('orca', '7d', 'project')
    }
  )

  it('rejects invalid providers, operations, missing arguments and unbounded limits', () => {
    for (const request of [
      { provider: 'cursor', operation: 'getScanState' },
      { provider: 'codex', operation: 'delete' },
      { provider: 'codex', operation: 'getSnapshot' },
      { provider: 'codex', operation: 'setEnabled', enabled: 'true' },
      { provider: 'codex', operation: 'getSnapshot', scope: 'all', range: 'all', limit: 10000 }
    ]) {
      expect(UsageAnalyticsParams.safeParse(request).success).toBe(false)
    }
  })
})
