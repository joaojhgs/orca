import { describe, expect, it } from 'vitest'
import {
  EXECUTION_USAGE_MAX_AGE_MS,
  EXECUTION_USAGE_POLL_MS,
  executionUsageTimestampIsFresh
} from './execution-usage-freshness'

const now = 1_000_000

describe('execution usage freshness', () => {
  it('allows bounded scheduling and collection time beyond the normal poll interval', () => {
    expect(executionUsageTimestampIsFresh(now - EXECUTION_USAGE_POLL_MS - 30_000, now)).toBe(true)
    expect(executionUsageTimestampIsFresh(now - EXECUTION_USAGE_MAX_AGE_MS, now)).toBe(true)
    expect(executionUsageTimestampIsFresh(now - EXECUTION_USAGE_MAX_AGE_MS - 1, now)).toBe(false)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, now + 5001])(
    'rejects missing, invalid or future timestamp %s',
    (timestamp) => expect(executionUsageTimestampIsFresh(timestamp, now)).toBe(false)
  )
})
