import type {
  RuntimeAccountServices,
  CodexRateLimitResetRpcResult
} from './runtime-account-controller'
import type { CodexResetCreditExpectedScope } from '../../../../shared/agent-accounts/codex/codex-reset-credit-scope'

export async function consumeCodexResetCredit(
  services: RuntimeAccountServices,
  idempotencyKey: string,
  expectedScope: CodexResetCreditExpectedScope
): Promise<CodexRateLimitResetRpcResult> {
  const { claudeAccounts, codexAccounts } = services
  const result = await codexAccounts.consumeRateLimitResetCredit(idempotencyKey, expectedScope)
  const snapshot = {
    claude: claudeAccounts.listAccounts(),
    codex: result.codex,
    rateLimits: result.rateLimits
  }
  if ('status' in result) {
    return {
      status: result.status,
      retryDisposition: result.retryDisposition,
      reason: result.reason,
      scope: result.scope,
      snapshot
    }
  }
  return { outcome: result.outcome, scope: result.scope, snapshot }
}
