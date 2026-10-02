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
  if (providerId === 'openrouter' && key) {
    const response = await request('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
      redirect: 'error'
    })
    if (!response.ok) {
      return null
    }
    const data = record(record(await response.json())?.data)
    const limit = data?.limit
    const remaining = data?.limit_remaining
    const buckets: RateLimitBucket[] = []
    if (
      typeof limit === 'number' &&
      Number.isFinite(limit) &&
      limit >= 0 &&
      typeof remaining === 'number' &&
      Number.isFinite(remaining)
    ) {
      buckets.push({
        name: 'API key budget (USD)',
        usedPercent: limit === 0 ? 100 : Math.min(100, Math.max(0, (1 - remaining / limit) * 100)),
        windowMinutes:
          data?.limit_reset === 'daily'
            ? 1440
            : data?.limit_reset === 'weekly'
              ? 10080
              : data?.limit_reset === 'monthly'
                ? 43200
                : 0,
        resetsAt: null,
        resetDescription: null
      })
    }
    const free = record(data?.free_model_daily_requests)
    if (
      typeof free?.limit === 'number' &&
      free.limit > 0 &&
      Number.isFinite(free.limit) &&
      typeof free.used === 'number' &&
      Number.isFinite(free.used)
    ) {
      buckets.push({
        name: 'Free models / day',
        usedPercent: Math.min(100, Math.max(0, (free.used / free.limit) * 100)),
        windowMinutes: 1440,
        resetsAt: null,
        resetDescription: null
      })
    }
    return {
      provider: 'opencode',
      session: null,
      weekly: null,
      buckets,
      updatedAt: Date.now(),
      status: buckets.length ? 'ok' : 'unavailable',
      error: buckets.length
        ? null
        : 'OpenRouter API key has no configured budget or reported request quota',
      usageMetadata: buckets.length ? {} : { failureKind: 'usage-unavailable' }
    }
  }
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
    const reason =
      providerId === 'anthropic'
        ? 'Anthropic API usage requires an Admin API credential; a regular API key does not expose subscription quota'
        : providerId === 'google'
          ? 'Google usage tracking is not implemented for this OpenCode credential type'
          : providerId === 'perplexity'
            ? 'Perplexity usage tracking is not implemented for this OpenCode credential type'
            : 'Usage tracking is not implemented for this OpenCode provider and credential type'
    return {
      provider: 'opencode',
      session: null,
      weekly: null,
      updatedAt: Date.now(),
      status: 'unavailable',
      error: reason,
      usageMetadata: { failureKind: 'usage-unavailable' }
    }
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
