import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { translate } from '@/i18n/i18n'
import type { PreloadApi } from '../../../../../preload/api-types'
import type { AccountControlRequest } from '../../../../../shared/rpc-contract/accounts/accounts-params'
import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../../../../../shared/agent-accounts/managed-account-types'
import { callRuntimeResult } from '../../runtime/client/web-runtime-calls'
import { requireActiveEnvironmentOrNull } from '../../runtime/client/web-runtime-session'
import { fetchAccountsSnapshot } from './web-rate-limits-api'
import { renameUnsupportedOnOldHost } from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'

const control = <T>(request: AccountControlRequest, timeout = 60_000): Promise<T> =>
  callRuntimeResult<T>('accounts.control', request, timeout)

export function createMiniMaxCredentialsApi(): PreloadApi['minimaxCredentials'] {
  return {
    getStatus: () => control({ operation: 'minimax.status' }),
    saveCookie: (secret) => control({ operation: 'minimax.saveCookie', secret }),
    clearCookie: () => control({ operation: 'minimax.clearCookie' }),
    saveApiKey: (secret) => control({ operation: 'minimax.saveApiKey', secret }),
    clearApiKey: () => control({ operation: 'minimax.clearApiKey' })
  }
}

export function createCursorAccountsApi(): PreloadApi['cursorAccounts'] {
  return { getStatus: () => control({ operation: 'cursor.status' }) }
}

export function createGrokAccountsApi(): PreloadApi['grokAccounts'] {
  return { getStatus: () => control({ operation: 'grok.status' }) }
}

export function createOpenCodeGoCredentialsApi(): PreloadApi['opencodeGoCredentials'] {
  return {
    getStatus: () => control({ operation: 'opencodeGo.status' }),
    saveApiKey: (secret) => control({ operation: 'opencodeGo.saveApiKey', secret }),
    clearApiKey: () => control({ operation: 'opencodeGo.clearApiKey' })
  }
}

export function createZcodePlanCredentialsApi(): PreloadApi['zcodePlanCredentials'] {
  return {
    getStatus: () => control({ operation: 'zcodePlan.status' }),
    saveApiKey: (secret) => control({ operation: 'zcodePlan.saveApiKey', secret }),
    clearApiKey: () => control({ operation: 'zcodePlan.clearApiKey' })
  }
}

// Why: select/remove await provider usage refreshes on the server; give an applied switch room.
const ACCOUNT_MUTATION_TIMEOUT_MS = 30_000

function servingHostLabel(): string {
  return translate(
    'auto.components.settings.AccountsPane.remoteServerFallback',
    'the remote server'
  )
}

// Account mutations run on the paired server.
export function createClaudeAccountsApi(): PreloadApi['claudeAccounts'] {
  return {
    list: async () => (await fetchAccountsSnapshot(false)).claude,
    add: (args) => control({ operation: 'claude.add', ...args }, 600_000),
    cancelPendingLogin: () => control({ operation: 'claude.cancelLogin' }),
    reauthenticate: (args) => control({ operation: 'claude.reauthenticate', ...args }, 600_000),
    waitForSignInLink: () => Promise.resolve(null),
    remove: (args) => callRuntimeResult('accounts.removeClaude', args, ACCOUNT_MUTATION_TIMEOUT_MS),
    rename: ({ accountId, displayName }) =>
      callRuntimeResult<ClaudeRateLimitAccountsState>(
        'accounts.renameClaude',
        { accountId, displayName },
        ACCOUNT_MUTATION_TIMEOUT_MS
      ).catch((error: unknown) => {
        throw renameUnsupportedOnOldHost(error, servingHostLabel())
      }),
    select: (args) => control({ operation: 'claude.select', ...args, movesRunningSessions: true })
  }
}

export function createCodexAccountsApi(): PreloadApi['codexAccounts'] {
  return {
    list: async () => (await fetchAccountsSnapshot(false)).codex,
    add: (args) => control({ operation: 'codex.add', ...args }, 600_000),
    cancelPendingLogin: () => control({ operation: 'codex.cancelLogin' }),
    getPendingLoginUrl: () => control({ operation: 'codex.pendingLoginUrl' }),
    onPendingLoginUrlChanged: (callback) => {
      const owner = requireActiveEnvironmentOrNull()?.id
      if (!owner) {
        return () => {}
      }
      let disposed = false
      let pending = false
      let previous: string | null | undefined
      const poll = async (): Promise<void> => {
        if (pending || disposed || requireActiveEnvironmentOrNull()?.id !== owner) {
          return
        }
        pending = true
        try {
          const url = await control<string | null>({ operation: 'codex.pendingLoginUrl' })
          if (!disposed && requireActiveEnvironmentOrNull()?.id === owner && url !== previous) {
            previous = url
            callback(url)
          }
        } catch {
          /* The owning connection reports transport failures. */
        } finally {
          pending = false
        }
      }
      const stopPolling = installWindowVisibilityInterval({
        intervalMs: 2000,
        run: () => void poll()
      })
      return () => {
        disposed = true
        stopPolling()
      }
    },
    reauthenticate: (args) => control({ operation: 'codex.reauthenticate', ...args }, 600_000),
    remove: (args) => callRuntimeResult('accounts.removeCodex', args, ACCOUNT_MUTATION_TIMEOUT_MS),
    rename: ({ accountId, displayName }) =>
      callRuntimeResult<CodexRateLimitAccountsState>(
        'accounts.renameCodex',
        { accountId, displayName },
        ACCOUNT_MUTATION_TIMEOUT_MS
      ).catch((error: unknown) => {
        throw renameUnsupportedOnOldHost(error, servingHostLabel())
      }),
    select: (args) =>
      args.runtime
        ? callRuntimeResult(
            'accounts.selectCodexForTarget',
            {
              accountId: args.accountId,
              target: { runtime: args.runtime, wslDistro: args.wslDistro ?? null }
            },
            ACCOUNT_MUTATION_TIMEOUT_MS
          )
        : callRuntimeResult(
            'accounts.selectCodex',
            { accountId: args.accountId },
            ACCOUNT_MUTATION_TIMEOUT_MS
          ),
    listStalePanes: (args) => control({ operation: 'codex.stalePanes', ...args }),
    listRecordedPaneLanes: (args) => control({ operation: 'codex.recordedPaneLanes', ...args }),
    forgetStalePanes: (args) => control({ operation: 'codex.forgetStalePanes', ...args })
  }
}
