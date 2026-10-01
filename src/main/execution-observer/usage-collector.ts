import type { ExecutionCredential } from '../../shared/execution-observer'
import type { ProviderRateLimits, UsageRateLimitFailureKind } from '../../shared/rate-limit-types'
import {
  credentialPaths,
  discoverExecutionCredentials,
  readCredentialRecord,
  record,
  text
} from './credential-discovery'
import { fetchCodexRateLimitsViaBackend } from '../rate-limits/codex-backend-usage-client'
import { fetchClaudeOAuthUsage } from '../rate-limits/claude-oauth-usage-request'
import { OAuthUsageError } from '../rate-limits/claude-oauth-usage-error'
import { fetchCursorRateLimits } from '../rate-limits/cursor-fetcher'
import { fetchAntigravityUsage } from './antigravity-usage'
import { fetchOpenCodeProviderUsage } from './opencode-provider-usage'
import { getProxyUrlFromEnvironment } from '../../shared/network-proxy'

function failed(
  credential: ExecutionCredential,
  failureKind: UsageRateLimitFailureKind,
  retryAtMs?: number
): ProviderRateLimits {
  return {
    provider: credential.provider,
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    status: 'error',
    error:
      failureKind === 'rate-limited'
        ? 'Usage is rate limited; waiting before retry'
        : failureKind === 'stale-token'
          ? 'Usage credentials are expired'
          : 'Execution-host usage is unavailable',
    usageMetadata: { failureKind, ...(retryAtMs ? { retryAtMs } : {}) }
  }
}

export async function collectExecutionUsage(
  credential: ExecutionCredential
): Promise<ProviderRateLimits> {
  const matches = async () =>
    (await discoverExecutionCredentials()).some(
      (found) =>
        found.sourceRef === credential.sourceRef &&
        found.accountKey === credential.accountKey &&
        found.provider === credential.provider &&
        found.providerId === credential.providerId &&
        (credential.identityConfidence === 'account' ||
          found.credentialRevision === credential.credentialRevision)
    )
  if (!(await matches())) {
    return failed(credential, 'missing-credentials')
  }
  const paths = credentialPaths()
  const nativeFetch = globalThis.fetch
  let httpFailure: { kind: UsageRateLimitFailureKind; retryAt?: number } | undefined
  const request: typeof fetch = async (url, init) => {
    // Why: the standalone worker must not silently bypass the execution host's proxy policy.
    const proxy = getProxyUrlFromEnvironment(process.env)
    if (!proxy.ok || proxy.value) {
      throw new Error('Execution-host proxy is unavailable')
    }
    const response = await nativeFetch(url, { ...init, redirect: init?.redirect ?? 'error' })
    if (!response.ok) {
      const retry = response.headers.get('retry-after')
      const seconds = Number(retry)
      const time =
        retry && Number.isFinite(seconds)
          ? Date.now() + Math.max(0, seconds * 1000)
          : Date.parse(retry ?? '')
      httpFailure = {
        kind:
          response.status === 429
            ? 'rate-limited'
            : response.status === 401
              ? 'stale-token'
              : 'server',
        ...(response.status === 429
          ? {
              retryAt:
                Number.isFinite(time) && time > Date.now()
                  ? Math.min(time, Date.now() + 86400000)
                  : Date.now() + 300000
            }
          : {})
      }
    }
    return response
  }
  // Why: reused Electron fetchers call the worker's net.fetch shim; route every request through one Retry-After guard.
  globalThis.fetch = request
  try {
    let result: ProviderRateLimits | null = null
    if (credential.provider === 'codex') {
      result = await fetchCodexRateLimitsViaBackend(request, { codexHomePath: paths.codexHome })
    }
    if (credential.provider === 'claude') {
      const token = text(record(readCredentialRecord(paths.claude)?.claudeAiOauth)?.accessToken)
      if (token) {
        result = await fetchClaudeOAuthUsage(token)
      }
    }
    if (credential.provider === 'cursor') {
      result = await fetchCursorRateLimits()
    }
    if (credential.provider === 'antigravity') {
      result = await fetchAntigravityUsage()
    }
    if (credential.provider === 'opencode' && credential.providerId) {
      const stored = record(readCredentialRecord(paths.opencode)?.[credential.providerId])
      if (stored) {
        result = await fetchOpenCodeProviderUsage(credential.providerId, stored, request)
      }
    }
    if (!(await matches())) {
      return failed(credential, 'missing-credentials')
    }
    if (httpFailure) {
      return failed(credential, httpFailure.kind, httpFailure.retryAt)
    }
    if (!result) {
      return failed(credential, 'usage-unavailable')
    }
    // Why: remote provider diagnostics must not carry arbitrary server responses or local paths.
    return {
      ...result,
      error: result.error
        ? `${credential.providerId || credential.provider} usage: ${result.usageMetadata?.failureKind || result.status}`
        : null,
      usageMetadata: {
        ...result.usageMetadata,
        credentialSource: credential.sourceRef,
        authProvenance: credential.accountKey ?? undefined
      }
    }
  } catch (error) {
    if (error instanceof OAuthUsageError) {
      return failed(
        credential,
        error.status === 429 ? 'rate-limited' : error.status === 401 ? 'stale-token' : 'server',
        error.status === 429 ? Date.now() + (error.retryAfterMs ?? 300000) : undefined
      )
    }
    return failed(credential, 'network')
  } finally {
    globalThis.fetch = nativeFetch
  }
}
