import type { ProviderRateLimits, RateLimitBucket } from '../../shared/rate-limit-types'
import { fetchOpenCodeGoUsageWithApiKey } from '../rate-limits/opencode-go-usage-api'
import { fetchZcodeRateLimits } from '../rate-limits/zcode-usage-fetcher'
import { record, text } from './credential-discovery'

export async function fetchOpenCodeProviderUsage(
  providerId: string,
  credential: Record<string, unknown>,
  request: typeof fetch
): Promise<ProviderRateLimits | null> {
  const key = text(credential.key)
  if (providerId === 'opencode-go' && key) {
    const result = await fetchOpenCodeGoUsageWithApiKey(key)
    if (result.kind === 'ok') {
      return {
        provider: 'opencode-go',
        ...result.windows,
        updatedAt: Date.now(),
        status: 'ok',
        error: null
      }
    }
    return {
      provider: 'opencode-go',
      session: null,
      weekly: null,
      updatedAt: Date.now(),
      status: result.kind === 'no-subscription' ? 'unavailable' : 'error',
      error:
        result.kind === 'unauthorized'
          ? 'OpenCode Go credentials are expired'
          : result.kind === 'no-subscription'
            ? 'No OpenCode Go subscription'
            : 'OpenCode Go usage request failed',
      usageMetadata: {
        failureKind:
          result.kind === 'unauthorized'
            ? 'stale-token'
            : result.kind === 'no-subscription'
              ? 'no-subscription'
              : 'network'
      }
    }
  }
  if (providerId === 'zai-coding-plan' && key) {
    return fetchZcodeRateLimits({ openCodeApiKey: key })
  }
  if (providerId !== 'github-copilot' || !text(credential.refresh)) {
    return null
  }
  const response = await request('https://api.github.com/copilot_internal/user', {
    headers: {
      Authorization: `token ${credential.refresh}`,
      Accept: 'application/json',
      'Editor-Version': 'vscode/1.96.2',
      'Editor-Plugin-Version': 'copilot-chat/0.26.7',
      'User-Agent': 'GitHubCopilotChat/0.26.7',
      'X-Github-Api-Version': '2025-04-01'
    },
    signal: AbortSignal.timeout(15000),
    redirect: 'error'
  })
  if (!response.ok) {
    return null
  }
  const payload = record(await response.json())
  const quotas = record(payload?.quota_snapshots)
  const buckets: RateLimitBucket[] = []
  for (const [name, value] of Object.entries(quotas ?? {})) {
    const quota = record(value)
    const remaining = quota?.percent_remaining
    if (
      quota?.unlimited === true ||
      typeof quota?.entitlement !== 'number' ||
      quota.entitlement <= 0 ||
      typeof remaining !== 'number' ||
      !Number.isFinite(remaining)
    ) {
      continue
    }
    buckets.push({
      name,
      usedPercent: Math.min(100, Math.max(0, 100 - remaining)),
      windowMinutes: 43200,
      resetsAt: null,
      resetDescription: null
    })
  }
  return {
    provider: 'opencode',
    session: null,
    weekly: null,
    buckets,
    monthly: buckets.find((bucket) => bucket.name === 'premium_interactions') ?? null,
    planType: text(payload?.copilot_plan),
    updatedAt: Date.now(),
    status: buckets.length ? 'ok' : 'unavailable',
    error: buckets.length ? null : 'GitHub Copilot exposes no metered quota for this plan',
    usageMetadata: {
      source: 'oauth',
      ...(buckets.length ? {} : { failureKind: 'usage-unavailable' })
    }
  }
}
