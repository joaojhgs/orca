import type { ExecutionAccountUsage } from '../../../shared/execution-observer'
import type { ManagerDispatchPolicy } from '../../../shared/manager-dispatch-capacity-contract'
import { ManagerCapacityUnavailableError } from './manager-authority-error'

const maximumAge = 5 * 60_000

/** No refresh, credentials or paid overage: only the current deduplicated collector reading. */
export function selectManagerDispatchAccount(
  accounts: readonly ExecutionAccountUsage[],
  target: { executionHostId: string; agent: string; model?: string },
  policy: ManagerDispatchPolicy,
  now: number
): ExecutionAccountUsage {
  const providerId = target.agent === 'opencode' ? target.model?.split('/')[0] : undefined
  const candidates = accounts.filter(
    (account) =>
      account.provider === target.agent &&
      (target.agent !== 'opencode' || (providerId && account.providerId === providerId)) &&
      account.sources.some(
        (source) => source.executionHostId === target.executionHostId && source.reachable
      )
  )
  if (candidates.length !== 1) {
    throw new ManagerCapacityUnavailableError(
      'Dispatch account is missing or ambiguous; choose an exact known provider/model and reconcile usage'
    )
  }
  const account = candidates[0]
  const limits = account.rateLimits
  const windows = [
    limits?.session,
    limits?.weekly,
    limits?.monthly,
    ...(limits?.buckets ?? [])
  ].filter((window) => window != null)
  if (
    !limits ||
    limits.status !== 'ok' ||
    limits.error ||
    account.error ||
    !Number.isFinite(limits.updatedAt) ||
    limits.updatedAt > now + 5000 ||
    now - limits.updatedAt > maximumAge ||
    !Number.isFinite(account.checkedAt) ||
    account.checkedAt > now + 5000 ||
    now - account.checkedAt > maximumAge ||
    (limits.usageMetadata?.retryAtMs ?? 0) > now ||
    !windows.length ||
    windows.some(
      (window) =>
        !Number.isFinite(window.usedPercent) ||
        window.usedPercent < 0 ||
        window.usedPercent >= policy.maximumUsedPercent
    )
  ) {
    throw new ManagerCapacityUnavailableError(
      'Dispatch quota is exhausted, stale or unverifiable; wait for a confirmed collector update'
    )
  }
  return account
}
