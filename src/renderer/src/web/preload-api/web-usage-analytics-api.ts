import type { PreloadApi } from '../../../../preload/api-types'
import { hasRuntimeRpcErrorCode } from '../../../../shared/remote-runtime/rpc/runtime-rpc-error-code'
import { UsageAnalyticsParams } from '../../../../shared/rpc-contract/usage-analytics-params'
import { createRuntimeUsageProviderApi } from '../../runtime/usage-analytics/runtime-usage-provider-api'
import { callRuntimeResult } from '../runtime/client/web-runtime-calls'
import { requireActiveEnvironment } from '../runtime/client/web-runtime-session'

const providerByNamespace = {
  claudeUsage: 'claude',
  codexUsage: 'codex',
  openCodeUsage: 'opencode',
  museUsage: 'muse'
} as const

type UsageNamespace = keyof typeof providerByNamespace

function createUsageApi<Key extends UsageNamespace>(namespace: Key): PreloadApi[Key] {
  return createRuntimeUsageProviderApi(async (method, request, timeoutMs) => {
    const owner = requireActiveEnvironment()
    try {
      return await callRuntimeResult(method, request, timeoutMs)
    } catch (error) {
      if (
        !hasRuntimeRpcErrorCode(error, 'method_not_found') ||
        !request ||
        typeof request !== 'object' ||
        !('method' in request) ||
        typeof request.method !== 'string'
      ) {
        throw error
      }
      const current = requireActiveEnvironment()
      if (
        owner.id !== current.id ||
        (owner.pairingRevision ?? owner.createdAt) !==
          (current.pairingRevision ?? current.createdAt)
      ) {
        throw error
      }
      const args = 'params' in request && typeof request.params === 'object' ? request.params : {}
      const legacy = UsageAnalyticsParams.safeParse({
        ...args,
        provider: providerByNamespace[namespace],
        operation: request.method.slice(namespace.length + 1)
      })
      if (!legacy.success) {
        throw error
      }
      return callRuntimeResult('usage.analytics', legacy.data, timeoutMs)
    }
  }, namespace)
}

export function createWebUsageAnalyticsApi(): Pick<PreloadApi, UsageNamespace> {
  return {
    claudeUsage: createUsageApi('claudeUsage'),
    codexUsage: createUsageApi('codexUsage'),
    openCodeUsage: createUsageApi('openCodeUsage'),
    museUsage: createUsageApi('museUsage')
  }
}
