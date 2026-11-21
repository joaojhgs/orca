import { UsageAnalyticsParams } from '../../../../shared/rpc-contract/usage-analytics-params'
import { invokeHostUsageAnalytics } from '../../../usage/host-usage-analytics'
import { defineMethod } from '../core'

export const USAGE_ANALYTICS_METHODS = [
  defineMethod({
    name: 'usage.analytics',
    permission: 'workspace',
    params: UsageAnalyticsParams,
    handler: (params, { clientKind }) => {
      if (clientKind === 'mobile') {
        throw new Error('Usage analytics require a runtime client')
      }
      const { provider, operation, ...request } = params
      return invokeHostUsageAnalytics({ method: `${provider}:${operation}`, params: request })
    }
  })
]
