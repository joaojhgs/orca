export const EXECUTION_USAGE_POLL_MS = 5 * 60_000
// Allow the observation tick and SSH/provider collection to finish before rejecting a reading.
export const EXECUTION_USAGE_MAX_AGE_MS = EXECUTION_USAGE_POLL_MS + 2 * 60_000

export function executionUsageTimestampIsFresh(timestamp: number, now: number): boolean {
  return (
    Number.isFinite(timestamp) &&
    timestamp > 0 &&
    timestamp <= now + 5000 &&
    now - timestamp <= EXECUTION_USAGE_MAX_AGE_MS
  )
}
