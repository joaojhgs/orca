import type { LocalBaseRefRefreshResult } from './base-ref-drift-types'
import type { LocalBaseBranchFastForwardOutcome } from './local-base-branch-fast-forward'

export function toLocalBaseRefRefreshResult(
  names: { baseRef: string; localBranch: string },
  outcome: LocalBaseBranchFastForwardOutcome | undefined
): LocalBaseRefRefreshResult | undefined {
  if (!outcome || outcome.status === 'nothing_to_do') {
    return undefined
  }
  return {
    baseRef: names.baseRef,
    localBranch: names.localBranch,
    status: outcome.status,
    ...(outcome.ownerWorktreePath ? { ownerWorktreePath: outcome.ownerWorktreePath } : {}),
    ...('shallowHistory' in outcome && outcome.shallowHistory ? { shallowHistory: true } : {})
  }
}

const REFRESH_STATUSES: readonly LocalBaseRefRefreshResult['status'][] = [
  'updated',
  'skipped_dirty_worktree',
  'skipped_not_fast_forward',
  'skipped_error'
]

export function parseLocalBaseBranchFastForwardOutcome(
  value: unknown
): LocalBaseBranchFastForwardOutcome {
  if (typeof value !== 'object' || value === null || !('status' in value)) {
    return { status: 'skipped_error' }
  }
  if (value.status === 'nothing_to_do') {
    return { status: 'nothing_to_do' }
  }
  const status = REFRESH_STATUSES.find((candidate) => candidate === value.status)
  if (!status) {
    return { status: 'skipped_error' }
  }
  const ownerWorktreePath = 'ownerWorktreePath' in value ? value.ownerWorktreePath : undefined
  return typeof ownerWorktreePath === 'string' && ownerWorktreePath
    ? { status, ownerWorktreePath }
    : { status }
}

/** How many commits a relay's inspection says local is behind, when it may be fast-forwarded. */
export function readFastForwardableBehindCount(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null || !('status' in value) || !('behind' in value)) {
    return undefined
  }
  const { behind } = value
  return value.status === 'behind' && typeof behind === 'number' && behind > 0 ? behind : undefined
}
