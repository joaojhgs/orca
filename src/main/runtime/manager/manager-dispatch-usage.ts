import type { ExecutionAccountUsage } from '../../../shared/execution-observer'
import type { ManagerDispatchPolicy } from '../../../shared/manager-dispatch-capacity-contract'
import { ManagerCapacityUnavailableError } from './manager-authority-error'
import { executionUsageTimestampIsFresh } from '../../../shared/execution-usage-freshness'

/** Current, uniquely attributed limits can refuse a dispatch. Missing and stale observations are advisory. */
export function selectManagerDispatchAccount(
  accounts: readonly ExecutionAccountUsage[],
  target: { executionHostId: string; agent: string; model?: string },
  policy: ManagerDispatchPolicy,
  now: number
): ExecutionAccountUsage | null {
  const providerId = target.agent === 'opencode' ? target.model?.split('/')[0] : undefined
  const candidates = accounts.filter(
    (account) =>
      account.provider === target.agent &&
      (target.agent !== 'opencode' || (providerId && account.providerId === providerId)) &&
      account.sources.some(
        (source) => source.executionHostId === target.executionHostId && source.reachable
      )
  )
  if (candidates.length > 1) {
    throw new ManagerCapacityUnavailableError(
      'More than one account matches this host and model; select the account before dispatch'
    )
  }
  const account = candidates[0]
  if (!account) {
    return null
  }
  const limits = account.rateLimits
  const windows = [
    limits?.session,
    limits?.weekly,
    limits?.monthly,
    ...(limits?.buckets ?? [])
  ].filter((window) => window != null)
  if (
    limits &&
    limits.status === 'ok' &&
    !limits.error &&
    !account.error &&
    executionUsageTimestampIsFresh(limits.updatedAt, now) &&
    executionUsageTimestampIsFresh(account.checkedAt, now) &&
    windows.some(
      (window) =>
        Number.isFinite(window.usedPercent) && window.usedPercent >= policy.maximumUsedPercent
    )
  ) {
    throw new ManagerCapacityUnavailableError('Current dispatch quota is exhausted')
  }
  return account
}
