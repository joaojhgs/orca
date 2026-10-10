import type { ExecutionAccountUsage } from '../../../shared/execution-observer'
import type { ManagerScopeGrant } from '../../../shared/manager-event-contract'

export function managerUsageInventory(
  accounts: readonly ExecutionAccountUsage[],
  grant: ManagerScopeGrant,
  now: number
) {
  return accounts.flatMap((account) => {
    const sources = account.sources
      .filter((source) => grant.executionHostIds.includes(source.executionHostId))
      .map((source) => ({
        executionHostId: source.executionHostId,
        label: source.label,
        reachable: source.reachable
      }))
    if (!sources.length) {
      return []
    }
    const limits = account.rateLimits
    return [
      {
        id: account.id,
        provider: account.provider,
        providerId: account.providerId ?? account.provider,
        identityConfidence: account.identityConfidence,
        sources,
        checkedAt: account.checkedAt,
        updatedAt: limits?.updatedAt ?? null,
        retryAt: account.retryAt,
        stale: !limits || now - limits.updatedAt > 5 * 60_000,
        status: limits?.status ?? 'unavailable',
        hasError: Boolean(account.error || limits?.error),
        quotas: limits
          ? {
              session: limits.session,
              weekly: limits.weekly,
              monthly: limits.monthly ?? null,
              buckets: limits.buckets ?? [],
              planType: limits.planType ?? null
            }
          : null
      }
    ]
  })
}
