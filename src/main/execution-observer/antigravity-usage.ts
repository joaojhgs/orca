import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProviderRateLimits, RateLimitBucket } from '../../shared/rate-limit-types'
import { runProcess } from '@orca/process-host'
import { record } from './credential-discovery'

export function parseAntigravityUsageReport(value: unknown): ProviderRateLimits | null {
  const report = record(value)
  if (report?.status !== 'SUCCESS' || record(report.command)?.name !== 'usage') {
    return null
  }
  const groups = record(record(report.command)?.data)?.groups
  if (!Array.isArray(groups)) {
    return null
  }
  const buckets: RateLimitBucket[] = []
  for (const rawGroup of groups.slice(0, 20)) {
    const group = record(rawGroup)
    if (!group || typeof group.name !== 'string' || !Array.isArray(group.buckets)) {
      continue
    }
    for (const rawBucket of group.buckets.slice(0, 20)) {
      const bucket = record(rawBucket)
      const remaining = bucket?.remaining_fraction
      const minutes = bucket?.window === 'weekly' ? 10080 : bucket?.window === '5h' ? 300 : null
      if (
        typeof remaining !== 'number' ||
        !Number.isFinite(remaining) ||
        remaining < 0 ||
        remaining > 1 ||
        !minutes
      ) {
        continue
      }
      const reset =
        typeof bucket?.reset_time === 'string' ? Date.parse(bucket.reset_time) : Number.NaN
      buckets.push({
        name: `${group.name}: ${minutes === 300 ? '5 hours' : 'weekly'}`,
        usedPercent: (1 - remaining) * 100,
        windowMinutes: minutes,
        resetsAt: Number.isFinite(reset) ? reset : null,
        resetDescription: null
      })
    }
  }
  if (!buckets.length) {
    return null
  }
  const mostUsed = (minutes: number) =>
    buckets
      .filter((bucket) => bucket.windowMinutes === minutes)
      .sort((left, right) => right.usedPercent - left.usedPercent)[0] ?? null
  return {
    provider: 'antigravity',
    session: mostUsed(300),
    weekly: mostUsed(10080),
    buckets,
    updatedAt: Date.now(),
    status: 'ok',
    error: null,
    usageMetadata: { source: 'cli' }
  }
}

export async function fetchAntigravityUsage(): Promise<ProviderRateLimits | null> {
  const candidates = [
    process.env.ANTIGRAVITY_CLI_PATH,
    join(homedir(), '.local', 'bin', 'agy'),
    '/usr/local/bin/agy',
    '/opt/homebrew/bin/agy'
  ]
  const program = candidates.find((candidate): candidate is string =>
    Boolean(candidate && existsSync(candidate))
  )
  if (!program || process.platform === 'win32') {
    return null
  }
  const cwd = await mkdtemp(join(tmpdir(), 'orca-antigravity-usage-'))
  try {
    // Why: /usage is a local slash command, not a model prompt or an interactive session.
    const output = await runProcess({
      program,
      args: ['-p', '/usage', '--output-format', 'json', '--print-timeout', '30s'],
      cwd,
      env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' },
      timeoutMs: 45_000,
      maxOutputBytes: 1024 * 1024,
      detached: true,
      terminationBarrier: true
    })
    if (output.code !== 0 || output.timedOut || output.outputTruncated) {
      return null
    }
    return parseAntigravityUsageReport(JSON.parse(output.stdout))
  } finally {
    // Why: this empty, uniquely owned probe directory never contains user work.
    await rm(cwd, { recursive: true, force: true })
  }
}
