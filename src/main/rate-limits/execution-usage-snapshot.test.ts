import { describe, expect, it } from 'vitest'
import type { RateLimitState, ProviderRateLimits } from '../../shared/rate-limit-types'
import type { ExecutionAccountUsage } from '../../shared/execution-observer'
import { withExecutionAccountUsage } from './execution-usage-snapshot'

const revision = 'a'.repeat(64)
const quota: ProviderRateLimits = {
  provider: 'claude',
  session: null,
  weekly: { usedPercent: 6, windowMinutes: 10080, resetsAt: null, resetDescription: null },
  updatedAt: 100000,
  status: 'ok',
  error: null
}
function state(): RateLimitState {
  return {
    claude: {
      ...quota,
      status: 'error',
      error: 'Expired host token',
      usageMetadata: { executionCredentialRevision: revision }
    },
    codex: null,
    cursor: null,
    antigravity: null,
    gemini: null,
    grok: null,
    kimi: null,
    opencodeGo: null,
    minimax: null,
    zcode: null,
    minimaxCookieConfigured: false,
    minimaxApiKeyConfigured: false,
    cursorAuthConfigured: false,
    grokAuthConfigured: false,
    opencodeGoApiKeyConfigured: false,
    claudeTarget: { runtime: 'host', wslDistro: null },
    codexTarget: { runtime: 'host', wslDistro: null },
    inactiveClaudeAccounts: [],
    inactiveCodexAccounts: []
  }
}
function account(): ExecutionAccountUsage {
  return {
    id: 'verified-account',
    provider: 'claude',
    sourceRef: 'claude:default',
    accountKey: 'c'.repeat(64),
    identityConfidence: 'account',
    sources: [
      {
        executionHostId: 'local',
        label: 'host',
        sourceRef: 'claude:default',
        reachable: true,
        credentialRevision: revision
      },
      {
        executionHostId: 'ssh:personal',
        label: 'personal',
        sourceRef: 'claude:default',
        reachable: true,
        credentialRevision: 'b'.repeat(64)
      }
    ],
    rateLimits: quota,
    checkedAt: 100000,
    retryAt: 400000
  }
}

describe('execution usage footer projection', () => {
  it('preserves upstream native Antigravity quota when no remote account is available', () => {
    const selected = state()
    selected.antigravity = { ...quota, provider: 'antigravity' }
    expect(withExecutionAccountUsage(selected, []).antigravity).toBe(selected.antigravity)
  })

  it('uses remote Antigravity quota when the controller has no selected account', () => {
    const remote = account()
    remote.provider = 'antigravity'
    remote.rateLimits = { ...quota, provider: 'antigravity' }
    expect(withExecutionAccountUsage(state(), [remote]).antigravity).toBe(remote.rateLimits)
  })

  it('uses a fresh same-account reading when the selected host token failed', () => {
    expect(withExecutionAccountUsage(state(), [account()]).claude).toEqual(quota)
  })

  it('never replaces a selected reading with another account or a rotated credential', () => {
    const selected = state()
    const other = account()
    other.sources[0]!.credentialRevision = 'd'.repeat(64)
    expect(withExecutionAccountUsage(selected, [other]).claude).toBe(selected.claude)
  })

  it('does not bind the selected host reading by an SSH credential revision', () => {
    const selected = state()
    const other = account()
    other.sources[0]!.credentialRevision = 'd'.repeat(64)
    other.sources[1]!.credentialRevision = revision
    expect(withExecutionAccountUsage(selected, [other]).claude).toBe(selected.claude)
  })

  it('never merges an unverified identity or uses an unverifiable host reading', () => {
    const selected = state()
    const unknown = account()
    unknown.identityConfidence = 'unknown'
    unknown.accountKey = null
    expect(withExecutionAccountUsage(selected, [unknown]).claude).toBe(selected.claude)
    const disconnected = account()
    disconnected.error = 'Execution-host observation is unverifiable'
    expect(withExecutionAccountUsage(selected, [disconnected]).claude).toBe(selected.claude)
  })

  it('keeps a successful selected reading and never fabricates quota from provider throttling', () => {
    const selected = state()
    selected.claude = quota
    expect(withExecutionAccountUsage(selected, [account()]).claude).toBe(quota)
    const failed = account()
    failed.rateLimits = { ...quota, status: 'error', error: 'Rate limited' }
    const pending = state()
    expect(withExecutionAccountUsage(pending, [failed]).claude).toBe(pending.claude)
  })
})
