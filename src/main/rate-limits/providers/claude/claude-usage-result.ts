import { createHash } from 'node:crypto'
import type {
  ProviderRateLimits,
  UsageRateLimitFailureKind,
  UsageRateLimitMetadata,
  UsageRateLimitSource
} from '../../../../shared/agent-usage/rate-limits/rate-limit-types'
import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth/runtime-auth-types'
import type { ClaudeOAuthCredentialReadResult } from './claude-oauth-credentials'

export function abortedClaudeRateLimitResult(): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error: 'Rate-limit fetch aborted',
    status: 'error'
  }
}

export function makeClaudeUsageResult(
  status: ProviderRateLimits['status'],
  error: string | null,
  metadata: UsageRateLimitMetadata
): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error,
    status,
    usageMetadata: metadata
  }
}

export function metadataForClaudeUsageAttempt(input: {
  attemptedSources: UsageRateLimitSource[]
  oauthCredentials: ClaudeOAuthCredentialReadResult
  authPreparation?: ClaudeRuntimeAuthPreparation
  source?: UsageRateLimitSource
  failureKind?: UsageRateLimitFailureKind
  deferredByLiveClaudeSession?: boolean
  retryAtMs?: number
}): UsageRateLimitMetadata {
  return {
    source: input.source,
    attemptedSources: [...input.attemptedSources],
    failureKind: input.failureKind,
    credentialSource: input.oauthCredentials.source,
    authProvenance: input.authPreparation?.provenance ?? 'system',
    executionCredentialRevision: input.oauthCredentials.token
      ? createHash('sha256').update(input.oauthCredentials.token).digest('hex')
      : undefined,
    deferredByLiveClaudeSession: input.deferredByLiveClaudeSession,
    retryAtMs: input.retryAtMs
  }
}

// Not idle: the meter draws idle as pending, and nothing here will settle it.
export function claudeOAuthUsageDisabledResult(): ProviderRateLimits {
  return makeClaudeUsageResult('unavailable', 'Usage appears when a Claude session runs.', {
    failureKind: 'usage-unavailable',
    attemptedSources: []
  })
}

// Account rows explain host/profile failures; usage keeps its generic message.
export function claudeUsageUnavailable(): ProviderRateLimits {
  return makeClaudeUsageResult('error', 'Claude usage is unavailable right now.', {
    failureKind: 'usage-unavailable',
    attemptedSources: []
  })
}
