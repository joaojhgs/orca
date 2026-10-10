import type { PreloadApi } from '../../../../preload/api-types'
import type { AccountControlRequest } from '../../../../shared/rpc-contract/accounts-params'
import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../../../../shared/managed-account-types'
import { callRuntimeResult } from './web-runtime-calls'
import { requireActiveEnvironmentOrNull } from './web-runtime-session'

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

// Why: the paired server owns Claude and Codex accounts; list, select and remove
// use its accounts.* RPCs. Sign-in needs the host's own login flow.
export function createClaudeAccountsApi(): PreloadApi['claudeAccounts'] {
  return {
    list: async () =>
      (
        await callRuntimeResult<{ claude: ClaudeRateLimitAccountsState }>('accounts.list', {
          refreshUsage: false
        })
      ).claude,
    add: (args) => control({ operation: 'claude.add', ...args }, 600_000),
    cancelPendingLogin: () => control({ operation: 'claude.cancelLogin' }),
    reauthenticate: (args) => control({ operation: 'claude.reauthenticate', ...args }, 600_000),
    waitForSignInLink: () => Promise.resolve(null),
    remove: (args) => callRuntimeResult('accounts.removeClaude', args),
    select: (args) => control({ operation: 'claude.select', ...args })
  }
}

export function createCodexAccountsApi(): PreloadApi['codexAccounts'] {
  return {
    list: async () =>
      (
        await callRuntimeResult<{ codex: CodexRateLimitAccountsState }>('accounts.list', {
          refreshUsage: false
        })
      ).codex,
    add: (args) => control({ operation: 'codex.add', ...args }, 600_000),
    cancelPendingLogin: () => control({ operation: 'codex.cancelLogin' }),
    getPendingLoginUrl: () => control({ operation: 'codex.pendingLoginUrl' }),
    onPendingLoginUrlChanged: (callback) => {
      const owner = requireActiveEnvironmentOrNull()?.id
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
      void poll()
      const timer = setInterval(() => void poll(), 2000)
      return () => {
        disposed = true
        clearInterval(timer)
      }
    },
    reauthenticate: (args) => control({ operation: 'codex.reauthenticate', ...args }, 600_000),
    remove: (args) => callRuntimeResult('accounts.removeCodex', args),
    select: (args) =>
      args.runtime
        ? callRuntimeResult('accounts.selectCodexForTarget', {
            accountId: args.accountId,
            target: { runtime: args.runtime, wslDistro: args.wslDistro ?? null }
          })
        : callRuntimeResult('accounts.selectCodex', { accountId: args.accountId }),
    listStalePanes: (args) => control({ operation: 'codex.stalePanes', ...args }),
    listRecordedPaneLanes: (args) => control({ operation: 'codex.recordedPaneLanes', ...args }),
    forgetStalePanes: (args) => control({ operation: 'codex.forgetStalePanes', ...args })
  }
}
