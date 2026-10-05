import type { PreloadApi } from '../../../../preload/api-types'
import { createEmptyRateLimitState } from '../../../../shared/rate-limit-state-factory'
import type { RateLimitState, RateLimitRuntimeTarget } from '../../../../shared/rate-limit-types'
import { callRuntimeResult } from './web-runtime-calls'
import { requireActiveEnvironmentOrNull } from './web-runtime-session'

export function createRateLimitsApi(): NonNullable<Partial<PreloadApi>['rateLimits']> {
  let state = createEmptyRateLimitState()
  const listeners = new Set<(state: RateLimitState) => void>()
  let timer: ReturnType<typeof setInterval> | undefined
  let interval = 60_000
  let pending: Promise<RateLimitState> | undefined
  const publish = (next: RateLimitState, owner: string | undefined): RateLimitState => {
    if (requireActiveEnvironmentOrNull()?.id !== owner) {
      throw new Error('Usage target changed while fetching. Refresh the connected host.')
    }
    state = next
    for (const listener of listeners) {
      listener(state)
    }
    return state
  }
  const read = async (refresh: boolean): Promise<RateLimitState> => {
    const owner = requireActiveEnvironmentOrNull()?.id
    const result = await callRuntimeResult<{ rateLimits: RateLimitState }>(
      'accounts.list',
      {
        refreshUsage: refresh
      },
      60_000
    )
    return publish(result.rateLimits, owner)
  }
  const poll = (): Promise<RateLimitState> => {
    if (pending) {
      return pending
    }
    const owner = requireActiveEnvironmentOrNull()?.id
    pending = callRuntimeResult<{ rateLimits: RateLimitState }>('accounts.usage', undefined, 60_000)
      .then((result) => {
        return publish(result.rateLimits, owner)
      })
      .catch(async (error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'method_not_found') {
          return read(false)
        }
        throw error
      })
      .finally(() => {
        pending = undefined
      })
    return pending
  }
  const refreshTarget = (target: RateLimitRuntimeTarget): Promise<RateLimitState> => {
    if (target.runtime !== 'host') {
      return Promise.reject(new Error('Browser usage tracking reads the connected host, not WSL.'))
    }
    return read(true)
  }
  return {
    get: () => read(false),
    refresh: () => read(true),
    refreshCodexForTarget: refreshTarget,
    // Why: web clients don't own local Codex auth; report the safe no-credit outcome since redemption is desktop-only.
    consumeCodexResetCredit: () => Promise.resolve({ outcome: 'noCredit', state }),
    refreshClaudeForTarget: refreshTarget,
    setPollingInterval: async (ms) => {
      interval = Number.isFinite(ms) ? Math.max(60_000, ms) : 60_000
      if (timer) {
        clearInterval(timer)
        timer = setInterval(() => {
          if (document.visibilityState === 'visible') {
            void poll().catch(() => {})
          }
        }, interval)
      }
    },
    fetchInactiveClaudeAccounts: async () => {
      await poll()
    },
    fetchInactiveCodexAccounts: async () => {
      await poll()
    },
    refreshMiniMax: () => read(true),
    refreshGrok: () => read(true),
    onUpdate: (listener) => {
      listeners.add(listener)
      if (!timer) {
        void poll().catch(() => {})
        timer = setInterval(() => {
          if (document.visibilityState === 'visible') {
            void poll().catch(() => {})
          }
        }, interval)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && timer) {
          clearInterval(timer)
          timer = undefined
        }
      }
    }
  }
}
