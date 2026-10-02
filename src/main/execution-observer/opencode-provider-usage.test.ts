import { describe, expect, it, vi } from 'vitest'
import { fetchOpenCodeProviderUsage } from './opencode-provider-usage'
import { executionUsageSchema } from '../../shared/execution-observer-response'

describe('OpenCode provider usage', () => {
  it.each(['google', 'perplexity', 'anthropic', 'unknown-provider'])(
    'reports unsupported %s tracking without pretending a refresh failed',
    async (provider) => {
      const request = vi.fn()
      const result = await fetchOpenCodeProviderUsage(provider, { key: 'fixture-key' }, request)
      expect(result).toMatchObject({
        status: 'unavailable',
        usageMetadata: { failureKind: 'usage-unavailable' }
      })
      expect(request).not.toHaveBeenCalled()
      expect(JSON.stringify(result)).not.toContain('fixture-key')
    }
  )

  it('reads an OpenRouter key budget, not a fabricated subscription quota', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: { limit: 100, limit_remaining: 75, limit_reset: 'monthly' } })
        )
      )
    const result = await fetchOpenCodeProviderUsage('openrouter', { key: 'fixture-key' }, request)
    expect(request).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/key',
      expect.objectContaining({ redirect: 'error' })
    )
    expect(result).toMatchObject({
      status: 'ok',
      buckets: [{ name: 'API key budget (USD)', usedPercent: 25, windowMinutes: 43200 }]
    })
  })

  it('does not invent available capacity for an unlimited or missing budget', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { limit: null, limit_remaining: null } }))
      )
    expect(
      await fetchOpenCodeProviderUsage('openrouter', { key: 'fixture-key' }, request)
    ).toMatchObject({ status: 'unavailable', buckets: [] })
  })

  it('retains an exhausted zero budget and a separate free-model request quota', async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            limit: 0,
            limit_remaining: 0,
            free_model_daily_requests: { used: 12, limit: 50 }
          }
        })
      )
    )
    const result = await fetchOpenCodeProviderUsage('openrouter', { key: 'fixture-key' }, request)
    expect(executionUsageSchema.safeParse(result).success).toBe(true)
    expect(result).toMatchObject({
      buckets: [{ usedPercent: 100 }, { name: 'Free models / day', usedPercent: 24 }]
    })
  })
})
