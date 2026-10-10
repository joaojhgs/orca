import { UsageAnalyticsParams } from '../../../../shared/rpc-contract/usage-analytics-params'
import { defineMethod } from '../core'

export const USAGE_ANALYTICS_METHODS = [
  defineMethod({
    name: 'usage.analytics',
    permission: 'workspace',
    params: UsageAnalyticsParams,
    handler: (params, { runtime, clientKind }) => {
      if (clientKind === 'mobile') {
        throw new Error('Usage analytics require a runtime client')
      }
      return runtime.controlUsageAnalytics(params)
    }
  })
]
