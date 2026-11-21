import type { AccountControlRequest } from '../../shared/rpc-contract/accounts/accounts-params'
import type { RuntimeAccountServices } from './agent-session/environment/runtime-account-controller'
import { getCursorAccountStatus } from '../cursor-accounts/status'
import { getGrokAccountStatus } from '../grok-accounts/status'
import {
  clearMiniMaxApiKeyCredential,
  clearMiniMaxSessionCookieCredential,
  getMiniMaxCredentialsStatus,
  saveMiniMaxApiKeyCredential,
  saveMiniMaxSessionCookieCredential
} from '../minimax/minimax-credential-commands'
import { listRecordedCodexPaneLanes } from '../codex/configuration/homes/codex-pane-account-registry'
import {
  forgetStaleCodexPanes,
  listStaleCodexPanes
} from '../codex/configuration/homes/codex-stale-pane-accounts'
import {
  clearOpenCodeGoApiKey,
  hasOpenCodeGoApiKey,
  saveOpenCodeGoApiKey
} from '../opencode/accounts/opencode-go-api-key-store'
import {
  clearZcodePlanApiKey,
  getZcodePlanApiKeyProtection,
  hasZcodePlanApiKey,
  saveZcodePlanApiKey
} from '../zcode/zcode-plan-api-key-store'
import { hasZcodeCliPlanCredentials } from '../rate-limits/providers/zcode/zcode-usage-credentials'
import { refreshAfterCredentialChange } from '../ipc/accounts/credential-change-rate-limit-refresh'

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
      return saveMiniMaxSessionCookieCredential(rateLimits, request.secret)
    case 'minimax.saveApiKey':
      return saveMiniMaxApiKeyCredential(rateLimits, request.secret)
    case 'minimax.clearCookie':
      return clearMiniMaxSessionCookieCredential(rateLimits)
    case 'minimax.clearApiKey':
      return clearMiniMaxApiKeyCredential(rateLimits)
  }
}
