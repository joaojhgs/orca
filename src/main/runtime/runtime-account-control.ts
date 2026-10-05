import type { AccountControlRequest } from '../../shared/rpc-contract/accounts-params'
import type { RuntimeAccountServices } from './runtime-account-controller'
import { getCursorAccountStatus } from '../cursor-accounts/status'
import { getGrokAccountStatus } from '../grok-accounts/status'
import { getMiniMaxCredentialsStatus } from '../minimax/minimax-credentials-status'
import {
  clearMiniMaxSessionCookie,
  saveMiniMaxSessionCookie
} from '../minimax/minimax-cookie-store'
import { clearMiniMaxApiKey, saveMiniMaxApiKey } from '../minimax/minimax-api-key-store'
import { clearMiniMaxSessionCookieJar } from '../rate-limits/minimax/minimax-request-context'
import { listRecordedCodexPaneLanes } from '../codex/codex-pane-account-registry'
import { forgetStaleCodexPanes, listStaleCodexPanes } from '../codex/codex-stale-pane-accounts'
import {
  clearOpenCodeGoApiKey,
  hasOpenCodeGoApiKey,
  saveOpenCodeGoApiKey
} from '../opencode/opencode-go-api-key-store'
import {
  clearZcodePlanApiKey,
  getZcodePlanApiKeyProtection,
  hasZcodePlanApiKey,
  saveZcodePlanApiKey
} from '../zcode/zcode-plan-api-key-store'
import { hasZcodeCliPlanCredentials } from '../rate-limits/zcode-usage-fetcher'
import { refreshAfterCredentialChange } from '../ipc/credential-change-rate-limit-refresh'

function zcodePlanStatus() {
  return {
    apiKeyConfigured: hasZcodePlanApiKey(),
    zcodeCliConfigured: hasZcodeCliPlanCredentials(),
    apiKeyProtection: getZcodePlanApiKeyProtection()
  }
}

export async function controlRuntimeAccount(
  services: RuntimeAccountServices,
  request: AccountControlRequest
): Promise<unknown> {
  const { claudeAccounts, codexAccounts, rateLimits } = services
  switch (request.operation) {
    case 'claude.add':
      return claudeAccounts.addAccount(request)
    case 'codex.add':
      return codexAccounts.addAccount(request)
    case 'claude.cancelLogin':
      return claudeAccounts.cancelPendingLogin()
    case 'codex.cancelLogin':
      return codexAccounts.cancelPendingLogin()
    case 'codex.pendingLoginUrl':
      return codexAccounts.getPendingLoginUrl()
    case 'claude.reauthenticate':
      return claudeAccounts.reauthenticateAccount(request.accountId)
    case 'codex.reauthenticate':
      return codexAccounts.reauthenticateAccount(request.accountId, {
        activateIfSelectionWasEmpty: request.activateIfSelectionWasEmpty === true
      })
    case 'claude.select':
      return request.runtime
        ? claudeAccounts.selectAccountForTarget(request.accountId, request)
        : claudeAccounts.selectAccount(request.accountId)
    case 'cursor.status':
      return getCursorAccountStatus()
    case 'grok.status':
      return getGrokAccountStatus()
    case 'opencodeGo.status':
      return { apiKeyConfigured: hasOpenCodeGoApiKey() }
    case 'opencodeGo.saveApiKey':
    case 'opencodeGo.clearApiKey':
      if (request.operation === 'opencodeGo.saveApiKey') {
        saveOpenCodeGoApiKey(request.secret)
      } else {
        clearOpenCodeGoApiKey()
      }
      refreshAfterCredentialChange(
        rateLimits,
        (service) =>
          service.invalidateOpenCodeGoCredentialState({
            apiKeyCleared: request.operation === 'opencodeGo.clearApiKey'
          }),
        '[accounts] OpenCode Go usage refresh failed'
      )
      return { apiKeyConfigured: hasOpenCodeGoApiKey() }
    case 'zcodePlan.status':
      return zcodePlanStatus()
    case 'zcodePlan.saveApiKey':
    case 'zcodePlan.clearApiKey':
      if (request.operation === 'zcodePlan.saveApiKey') {
        saveZcodePlanApiKey(request.secret)
      } else {
        clearZcodePlanApiKey()
      }
      refreshAfterCredentialChange(
        rateLimits,
        (service) => service.invalidateZcodeCredentialState(),
        '[accounts] GLM Coding Plan usage refresh failed'
      )
      return zcodePlanStatus()
    case 'minimax.status':
      return getMiniMaxCredentialsStatus()
    case 'codex.stalePanes': {
      const settings = services.getSettings?.()
      if (!settings) {
        throw new Error('Runtime settings are unavailable')
      }
      return listStaleCodexPanes({
        ptyIds: request.ptyIds,
        settings
      })
    }
    case 'codex.recordedPaneLanes':
      return listRecordedCodexPaneLanes(request.ptyIds)
    case 'codex.forgetStalePanes':
      return forgetStaleCodexPanes(request.ptyIds)
    case 'minimax.saveCookie':
      saveMiniMaxSessionCookie(request.secret)
      break
    case 'minimax.saveApiKey':
      saveMiniMaxApiKey(request.secret)
      break
    case 'minimax.clearCookie':
      clearMiniMaxSessionCookie()
      await clearMiniMaxSessionCookieJar()
      break
    case 'minimax.clearApiKey':
      clearMiniMaxApiKey()
      break
  }
  rateLimits.invalidateMiniMaxCredentialState()
  void rateLimits
    .refreshIfStale()
    .catch(() => console.warn('[accounts] Usage refresh failed after credential change'))
  return getMiniMaxCredentialsStatus()
}
