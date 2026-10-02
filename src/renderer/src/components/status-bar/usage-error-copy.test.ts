import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

import {
  getProviderDisplayName,
  getProviderUsageErrorMessage,
  getProviderUsageStatusLabel
} from './usage-error-copy'

describe('getProviderDisplayName', () => {
  it('returns the Antigravity brand name', () => {
    expect(getProviderDisplayName('antigravity')).toBe('Antigravity')
  })

  it('returns the MiniMax brand name', () => {
    expect(getProviderDisplayName('minimax')).toBe('MiniMax')
  })

  it('returns the existing provider brand names', () => {
    expect(getProviderDisplayName('claude')).toBe('Claude')
    expect(getProviderDisplayName('codex')).toBe('Codex')
    expect(getProviderDisplayName('gemini')).toBe('Gemini')
    expect(getProviderDisplayName('opencode-go')).toBe('OpenCode Go')
    expect(getProviderDisplayName('kimi')).toBe('Kimi')
    expect(getProviderDisplayName('grok')).toBe('Grok')
  })

  it('falls back to the raw provider id when no mapping exists', () => {
    // Why: provider id is a closed union, but TypeScript may not enforce
    // exhaustiveness on dynamic callers. Fallback keeps logging safe.
    expect(getProviderDisplayName('unknown-provider' as never)).toBe('unknown-provider')
  })
})

describe('unsubscribed OpenCode Go accounts', () => {
  const noSubscription = {
    provider: 'opencode-go',
    session: null,
    weekly: null,
    monthly: null,
    updatedAt: 0,
    error:
      'This OpenCode account has no OpenCode Go subscription. Subscribe at opencode.ai to see Go usage.',
    status: 'error',
    usageMetadata: { failureKind: 'no-subscription' }
  } as const

  it('labels the entitlement verdict instead of a refresh failure', () => {
    expect(getProviderUsageStatusLabel(noSubscription)).toBe('No subscription')
  })

  it('keeps the specific message rather than the generic auth copy', () => {
    expect(getProviderUsageErrorMessage(noSubscription)).toBe(noSubscription.error)
  })
})

describe('execution-host diagnostics', () => {
  const expired = {
    provider: 'claude',
    session: null,
    weekly: null,
    updatedAt: 0,
    status: 'error',
    error: 'Expired token',
    usageMetadata: { failureKind: 'stale-token', credentialSource: 'claude:default' }
  } as const
  it('does not claim to refresh a remote sign-in owned by the agent runtime', () => {
    expect(getProviderUsageStatusLabel(expired)).toBe('Sign-in expired on source host')
    expect(getProviderUsageErrorMessage(expired)).toContain('listed execution host')
    expect(
      getProviderUsageStatusLabel({
        ...expired,
        usageMetadata: { ...expired.usageMetadata, credentialSource: 'credentials-file' }
      })
    ).toBe('Refreshing sign-in')
  })
  it('does not label an unsupported OpenCode collector as a failed login or refresh', () => {
    expect(
      getProviderUsageStatusLabel({
        ...expired,
        provider: 'opencode',
        usageMetadata: { failureKind: 'usage-unavailable' }
      })
    ).toBe('Usage tracking unavailable')
  })
})
