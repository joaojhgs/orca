import type { UsageAnalyticsRequest } from '../../shared/rpc-contract/usage-analytics-params'

type UsageAnalyticsStore = {
  getScanState(): unknown
  setEnabled(enabled: boolean): unknown
  refresh(force?: boolean): unknown
  getSnapshot(scope: 'orca' | 'all', range: '7d' | '30d' | '90d' | 'all', limit?: number): unknown
  getSummary(scope: 'orca' | 'all', range: '7d' | '30d' | '90d' | 'all'): unknown
  getDaily(scope: 'orca' | 'all', range: '7d' | '30d' | '90d' | 'all'): unknown
  getBreakdown(
    scope: 'orca' | 'all',
    range: '7d' | '30d' | '90d' | 'all',
    kind: 'model' | 'project'
  ): unknown
  getRecentSessions(
    scope: 'orca' | 'all',
    range: '7d' | '30d' | '90d' | 'all',
    limit?: number
  ): unknown
}

export type UsageAnalyticsStores = Record<UsageAnalyticsRequest['provider'], UsageAnalyticsStore>

/** Browser analytics use the same persisted scanner and cache as Electron, not a second collector. */
export function controlUsageAnalytics(
  stores: UsageAnalyticsStores,
  request: UsageAnalyticsRequest
): unknown {
  const store = stores[request.provider]
  switch (request.operation) {
    case 'getScanState':
      return store.getScanState()
    case 'setEnabled':
      return store.setEnabled(request.enabled)
    case 'refresh':
      return store.refresh(request.force ?? false)
    case 'getSnapshot':
      return store.getSnapshot(request.scope, request.range, request.limit)
    case 'getSummary':
      return store.getSummary(request.scope, request.range)
    case 'getDaily':
      return store.getDaily(request.scope, request.range)
    case 'getBreakdown':
      return store.getBreakdown(request.scope, request.range, request.kind)
    case 'getRecentSessions':
      return store.getRecentSessions(request.scope, request.range, request.limit)
  }
}
