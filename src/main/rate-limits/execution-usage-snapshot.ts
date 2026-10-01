import type { RateLimitState, ProviderRateLimits } from '../../shared/rate-limit-types'
import type { ExecutionAccountUsage } from '../../shared/execution-observer'

export function withExecutionAccountUsage(
  state: RateLimitState,
  accounts: ExecutionAccountUsage[]
): RateLimitState {
  const result = { ...state, executionAccounts: accounts }
  const take = (provider: ProviderRateLimits['provider'], current: ProviderRateLimits | null) => {
    // Why: never relabel a selected local account with a different remote account's quota.
    if (current && current.status !== 'unavailable') {
      return current
    }
    return (
      accounts.find(
        (account) =>
          !account.error &&
          account.sources.some((source) => source.reachable) &&
          account.rateLimits?.provider === provider &&
          account.rateLimits.status === 'ok'
      )?.rateLimits ?? current
    )
  }
  result.claude = take('claude', state.claude)
  result.codex = take('codex', state.codex)
  result.cursor = take('cursor', state.cursor)
  result.antigravity =
    accounts.find(
      (account) =>
        account.provider === 'antigravity' &&
        !account.error &&
        account.sources.some((source) => source.reachable)
    )?.rateLimits ?? null
  result.opencodeGo = take('opencode-go', state.opencodeGo)
  result.zcode = take('zcode', state.zcode)
  result.cursorAuthConfigured ||= accounts.some((account) => account.provider === 'cursor')
  result.opencodeGoApiKeyConfigured ||= accounts.some(
    (account) => account.providerId === 'opencode-go'
  )
  return result
}
