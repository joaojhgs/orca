import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import type { RateLimitState } from '../../shared/rate-limit-types'
import { resolveHostFlagTarget, hostFilterMatchesHostId } from '../execution-host-flag'
import { parseExecutionHostId, toSshExecutionHostId } from '../../shared/execution-host'
import { readOrchestrationCompatibilityEvidence } from '../../shared/orchestration-compatibility-evidence'
import { RuntimeClientError } from '../runtime/types'

export const accountUsage: CommandHandler = async (ctx) => {
  if (ctx.flags.has('all-hosts') && ctx.flags.has('host')) {
    throw new RuntimeClientError('invalid_argument', 'Use either --all-hosts or --host, not both.')
  }
  const caller = readOrchestrationCompatibilityEvidence(process.env)?.host
  const defaultHostId = caller?.kind === 'ssh' ? toSshExecutionHostId(caller.targetId) : 'local'
  const host = ctx.flags.has('all-hosts')
    ? undefined
    : ((await resolveHostFlagTarget(ctx.flags, ctx.client)) ?? parseExecutionHostId(defaultHostId)!)
  const result = await ctx.client.call<{ rateLimits: RateLimitState }>(
    'accounts.usage',
    undefined,
    { timeoutMs: 120000 }
  )
  // Preserve the legacy RPC and its cache. Filtering here also works with older remote relays.
  const scoped = {
    ...result,
    result: {
      scope: { mode: host ? 'host' : 'all', executionHostId: host?.id ?? null },
      rateLimits: {
        executionAccounts: (result.result.rateLimits.executionAccounts ?? [])
          .filter(
            (account) =>
              !host ||
              account.sources.some((source) =>
                hostFilterMatchesHostId(host, source.executionHostId)
              )
          )
          .map((account) => ({
            ...account,
            sources: account.sources.filter(
              (source) => !host || hostFilterMatchesHostId(host, source.executionHostId)
            )
          }))
      }
    }
  }
  printResult(scoped, ctx.json, (snapshot) => {
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
          .map(
            (window) =>
              `${window.windowMinutes === 0 ? 'total budget' : `${window.windowMinutes}m`}: ${window.usedPercent.toFixed(1)}% used`
          )
          .join(', ')
        const hosts = account.sources
          .map((source) => `${source.label}${source.reachable ? '' : ' (unverifiable)'}`)
          .join(' + ')
        return `${account.providerId || account.provider} [${hosts}]: ${account.error || limits?.error || quota || 'usage unavailable'}`
      })
      .join('\n')
  })
}
