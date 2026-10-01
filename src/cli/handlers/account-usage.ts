import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import type { RateLimitState } from '../../shared/rate-limit-types'

export const accountUsage: CommandHandler = async (ctx) => {
  const result = await ctx.client.call<{ rateLimits: RateLimitState }>(
    'accounts.usage',
    undefined,
    { timeoutMs: 120000 }
  )
  printResult(result, ctx.json, (snapshot) => {
    const accounts = snapshot.rateLimits.executionAccounts
    if (!accounts?.length) {
      return 'No execution-host usage has been discovered yet. Retry after the collector finishes.'
    }
    return accounts
      .map((account) => {
        const limits = account.rateLimits
        const windows = limits?.buckets?.length
          ? limits.buckets
          : [limits?.session, limits?.weekly, limits?.monthly].filter((window) => window != null)
        const quota = windows
          .map((window) => `${window.windowMinutes}m: ${window.usedPercent.toFixed(1)}% used`)
          .join(', ')
        const hosts = account.sources
          .map((source) => `${source.label}${source.reachable ? '' : ' (unverifiable)'}`)
          .join(' + ')
        return `${account.providerId || account.provider} [${hosts}]: ${account.error || limits?.error || quota || 'usage unavailable'}`
      })
      .join('\n')
  })
}
