import type { ClaudeUsageSnapshot } from '../../../../shared/claude-usage-types'
import type { CodexUsageSnapshot } from '../../../../shared/codex-usage-types'
import type { OpenCodeUsageSnapshot } from '../../../../shared/opencode-usage-types'
import type { MuseUsageSnapshot } from '../../../../shared/muse-usage-types'
import type { UsageAnalyticsRequest } from '../../../../shared/rpc-contract/usage-analytics-params'
import type { PreloadApi } from '../../../../preload/api-types'
import { callRuntimeResult } from './web-runtime-calls'

type Snapshot = ClaudeUsageSnapshot | CodexUsageSnapshot | OpenCodeUsageSnapshot | MuseUsageSnapshot
type RangeArgs = { scope: 'orca' | 'all'; range: '7d' | '30d' | '90d' | 'all' }

function createUsageApi<T extends Snapshot>(provider: UsageAnalyticsRequest['provider']) {
  return {
    getScanState: () =>
      callRuntimeResult<T['scanState']>('usage.analytics', { provider, operation: 'getScanState' }),
    setEnabled: (args: { enabled: boolean }) =>
      callRuntimeResult<T['scanState']>('usage.analytics', {
        provider,
        operation: 'setEnabled',
        ...args
      }),
    refresh: (args?: { force?: boolean }) =>
      callRuntimeResult<T['scanState']>(
        'usage.analytics',
        { provider, operation: 'refresh', ...args },
        120_000
      ),
    getSnapshot: (args: RangeArgs & { limit?: number }) =>
      callRuntimeResult<T>('usage.analytics', { provider, operation: 'getSnapshot', ...args }),
    getSummary: (args: RangeArgs) =>
      callRuntimeResult<T['summary']>('usage.analytics', {
        provider,
        operation: 'getSummary',
        ...args
      }),
    getDaily: (args: RangeArgs) =>
      callRuntimeResult<T['daily']>('usage.analytics', {
        provider,
        operation: 'getDaily',
        ...args
      }),
    getBreakdown: (args: RangeArgs & { kind: 'model' | 'project' }) =>
      callRuntimeResult<T['modelBreakdown']>('usage.analytics', {
        provider,
        operation: 'getBreakdown',
        ...args
      }),
    getRecentSessions: (args: RangeArgs & { limit?: number }) =>
      callRuntimeResult<T['recentSessions']>('usage.analytics', {
        provider,
        operation: 'getRecentSessions',
        ...args
      })
  }
}

export function createWebUsageAnalyticsApi(): Pick<
  PreloadApi,
  'claudeUsage' | 'codexUsage' | 'openCodeUsage' | 'museUsage'
> {
  return {
    claudeUsage: createUsageApi<ClaudeUsageSnapshot>('claude'),
    codexUsage: createUsageApi<CodexUsageSnapshot>('codex'),
    openCodeUsage: createUsageApi<OpenCodeUsageSnapshot>('opencode'),
    museUsage: createUsageApi<MuseUsageSnapshot>('muse')
  }
}
