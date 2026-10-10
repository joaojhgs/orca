import { createHash } from 'node:crypto'
import type {
  ProviderRateLimits,
  UsageRateLimitFailureKind,
  UsageRateLimitMetadata,
  UsageRateLimitSource
} from '../../shared/rate-limit-types'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth-service'
import type { ClaudeOAuthCredentialReadResult } from './claude-oauth-credentials'
import { OAuthUsageError } from './claude-oauth-usage-error'

export type ClaudeUsageAttemptState = {
  attemptedSources: UsageRateLimitSource[]
}

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

export function warnClaudeUsageFetchFailure(
  authPreparation: ClaudeRuntimeAuthPreparation | undefined,
  credentials: ClaudeOAuthCredentialReadResult,
  error: unknown
): void {
  console.warn('[claude-rate-limits] Claude usage refresh failed', {
    provenance: authPreparation?.provenance ?? 'system',
    runtime: authPreparation?.runtime ?? 'host',
    wslDistro: authPreparation?.wslDistro ?? null,
    hasExplicitClaudeConfigDir: Boolean(authPreparation?.envPatch.CLAUDE_CONFIG_DIR),
    credentialSource: credentials.source,
    keychainUnavailable: credentials.keychainUnavailable,
    hasRefreshableCredentials: credentials.hasRefreshableCredentials,
    status: error instanceof OAuthUsageError ? error.status : null,
    message: error instanceof Error ? error.message : String(error)
  })
}

// Why plain: the profile/host reason is shown on the account row, not as raw text in usage.
export function claudeUsageUnavailable(): ProviderRateLimits {
  return makeClaudeUsageResult('error', 'Claude usage is unavailable right now.', {
    failureKind: 'usage-unavailable',
    attemptedSources: []
  })
}
