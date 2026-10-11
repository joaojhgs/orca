import { vi } from 'vitest'
import type { ExecutionAccountUsage } from '../../../shared/execution-observer'
import type { OrcaRuntimeService } from '../orca-runtime'
import type { HostMemory } from '../../../shared/process-stats-types'
import { createEmptyRateLimitState } from '../../../shared/rate-limit-state-factory'
import {
  registerRemoteResourceProvider,
  unregisterRemoteResourceProvider
} from '../../memory/remote-resource-provider-registry'

export const dispatchHost: HostMemory = {
  totalMemory: 12 * 1024 ** 3,
  freeMemory: 8 * 1024 ** 3,
  availableMemory: 9 * 1024 ** 3,
  availableMemorySource: 'proc-meminfo',
  usedMemory: 3 * 1024 ** 3,
  memoryUsagePercent: 25,
  cpuCoreCount: 2,
  loadAverage1m: 0.5
}

export function dispatchAccount(now = Date.now()): ExecutionAccountUsage {
  return {
    id: 'shared-account',
    provider: 'codex',
    accountKey: 'a'.repeat(64),
    identityConfidence: 'account',
    sourceRef: 'private-source',
    checkedAt: now,
    retryAt: now + 5 * 60_000,
    sources: [
      {
        executionHostId: 'ssh:worker',
        label: 'Worker',
        sourceRef: 'private-source',
        reachable: true
      },
      {
        executionHostId: 'ssh:second',
        label: 'Second',
        sourceRef: 'private-second',
        reachable: true
      }
    ],
    rateLimits: {
      provider: 'codex',
      status: 'ok',
      error: null,
      updatedAt: now,
      session: {
        usedPercent: 10,
        resetsAt: now + 60_000,
        resetDescription: null,
        windowMinutes: 300
      },
      weekly: {
        usedPercent: 60,
        resetsAt: now + 120_000,
        resetDescription: null,
        windowMinutes: 10080
      }
    }
  }
}

export function installDispatchReadings(runtime: OrcaRuntimeService) {
  const account = dispatchAccount()
  const snapshot = {
    claude: { accounts: [], activeAccountId: null },
    codex: { accounts: [], activeAccountId: null },
    rateLimits: createEmptyRateLimitState({ executionAccounts: [account] })
  }
  vi.spyOn(runtime, 'getAccountsSnapshot').mockReturnValue(snapshot)
  const collect = vi.fn(async () => ({ host: { ...dispatchHost }, worktrees: [] }))
  registerRemoteResourceProvider('worker', { name: 'Worker', collect })
  return { account, snapshot, collect }
}

export function cleanupDispatchReadings(): void {
  unregisterRemoteResourceProvider('worker')
  unregisterRemoteResourceProvider('second')
}
