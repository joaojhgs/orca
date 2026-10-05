import { describe, expect, it } from 'vitest'
import { parseAntigravityUsageReport } from './antigravity-usage'

describe('Antigravity non-interactive usage report', () => {
  const report = {
    status: 'SUCCESS',
    command: {
      name: 'usage',
      data: {
        groups: [
          {
            name: 'Gemini Models',
            buckets: [
              { window: 'weekly', remaining_fraction: 0.75, reset_time: '2026-10-08T21:23:51Z' },
              { window: '5h', remaining_fraction: 0.9, reset_time: '2026-10-02T02:23:51Z' }
            ]
          },
          {
            name: 'Claude and GPT models',
            buckets: [
              { window: 'weekly', remaining_fraction: 0.5 },
              { window: '5h', remaining_fraction: 0.8 }
            ]
          }
        ]
      }
    }
  }
  it('keeps every actual quota pool and selects the tightest summary for each cadence', () => {
    const result = parseAntigravityUsageReport(report)
    expect(result?.buckets).toHaveLength(4)
    expect(result?.weekly?.usedPercent).toBe(50)
    expect(result?.session?.usedPercent).toBeCloseTo(20)
    expect(result?.weekly?.resetsAt).toBeNull()
  })
  it('does not invent cadence, availability percentages, or missing quotas', () => {
    expect(
      parseAntigravityUsageReport({
        status: 'SUCCESS',
        command: {
          name: 'usage',
          data: {
            groups: [
              {
                name: 'Gemini',
                buckets: [
                  { remaining_fraction: 1 },
                  { window: '5h' },
                  { window: 'weekly', remaining_fraction: -1 }
                ]
              }
            ]
          }
        }
      })
    ).toBeNull()
    expect(
      parseAntigravityUsageReport({ ...report, command: { ...report.command, name: 'prompt' } })
    ).toBeNull()
    expect(parseAntigravityUsageReport({ ...report, status: 'ERROR' })).toBeNull()
  })
})
