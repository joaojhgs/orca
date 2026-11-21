import { scanLocalAiVaultSessionsAsIssue } from './ai-vault-local-scan'
import type { AiVaultProjectionDependency } from './ai-vault-projection-dependency'
import {
  aiVaultScanIssueResult,
  mergeAiVaultListResults
} from '../../ai-vault/listing/session-list-results'
import {
  AI_VAULT_SINGLE_HOST_LIST_TIMEOUT_MS,
  type AiVaultListArgs,
  type AiVaultListResult
} from '../../../shared/ai-vault/contracts/ai-vault-types'
import {
  LOCAL_EXECUTION_HOST_ID,
  parseRoutableExecutionHostId,
  toRuntimeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host/execution-host'
import type { SshRelayAiVaultHostInfo } from '../../ssh/ssh-relay-session'
import { scanSshAiVaultSessions } from './ai-vault-ssh-scan'
import type { AiVaultHostDiscoveryResult } from './ai-vault-host-discovery'
import {
  scanRuntimeAiVaultSessions,
  type RuntimeAiVaultHostInfo,
  type RuntimeAiVaultScanner
} from '../../ai-vault/runtime-hosts/ai-vault-runtime-scan'
import { scanHostLegWithCache } from './ai-vault-host-leg-cache'
import { requestedAiVaultSessionDepth } from '../../../shared/ai-vault/scanning/ai-vault-session-depth'
import {
  AI_VAULT_ALL_HOST_TIMEOUT_MS,
  allHostsRuntimeScanTimeoutMs
} from './ai-vault-all-host-timeouts'

export type AiVaultScanHostScope =
  | { scope: ExecutionHostId }
  | {
      scope: 'all'
      runtimeHosts: AiVaultHostDiscoveryResult<RuntimeAiVaultHostInfo>
      sshHosts: AiVaultHostDiscoveryResult<SshRelayAiVaultHostInfo>
    }

export async function scanAiVaultSessionsByHostScope(
  args: AiVaultListArgs | undefined,
  hostScope: AiVaultScanHostScope,
  signal: AbortSignal,
  cacheKey: string,
  dependency: AiVaultProjectionDependency,
  scanner: RuntimeAiVaultScanner | undefined
): Promise<AiVaultListResult> {
  const depth = requestedAiVaultSessionDepth(args)
  const scopePaths = args?.scopePaths ?? []
  if (hostScope.scope === LOCAL_EXECUTION_HOST_ID) {
    return scanLocalAiVaultSessionsAsIssue(args, signal)
  }
  if (hostScope.scope === 'all') {
    const { runtimeHosts, sshHosts } = hostScope
    const discoveryIssues = [
      ...(runtimeHosts.issue ? [runtimeHosts.issue] : []),
      ...(sshHosts.issue ? [sshHosts.issue] : [])
    ]
    const scannedResults = await Promise.all([
      scanLocalAiVaultSessionsAsIssue(args, signal),
      ...sshHosts.hostInfos.map(({ targetId }) =>
        scanHostLegWithCache({
          cacheKey: `${cacheKey}|${toSshExecutionHostId(targetId)}`,
          depth,
          scopePaths,
          force: args?.force === true,
          scan: () =>
            scanSshAiVaultSessions(targetId, args, {
              signal,
              timeoutMs: AI_VAULT_ALL_HOST_TIMEOUT_MS.sshScan,
              relayTimeoutMs: AI_VAULT_ALL_HOST_TIMEOUT_MS.sshScanRelay
            })
        })
      ),
      ...runtimeHosts.hostInfos.map((hostInfo) =>
        scanHostLegWithCache({
          cacheKey: `${cacheKey}|${hostInfo.executionHostId}`,
          dependency: dependency.forHost(hostInfo.environmentId),
          depth,
          scopePaths,
          force: args?.force === true,
          scan: () =>
            scanRuntimeAiVaultSessions({
              hostInfo,
              scanner,
              listArgs: args ? { ...args, afterFingerprint: undefined } : undefined,
              options: {
                signal,
                timeoutMs: allHostsRuntimeScanTimeoutMs(hostInfo)
              }
            })
        })
      )
    ])
    return mergeAiVaultListResults(
      [...scannedResults, ...discoveryIssues],
      args?.limit,
      args?.unlimited,
      scopePaths
    )
  }

  const executionHostScope = hostScope.scope
  const parsed = parseRoutableExecutionHostId(executionHostScope)
  if (parsed?.kind === 'ssh') {
    return scanSshAiVaultSessions(parsed.targetId, args, {
      signal,
      timeoutMs: AI_VAULT_SINGLE_HOST_LIST_TIMEOUT_MS
    })
  }
  if (parsed?.kind === 'runtime') {
    return scanRuntimeAiVaultSessions({
      hostInfo: {
        environmentId: parsed.environmentId,
        executionHostId: toRuntimeExecutionHostId(parsed.environmentId)
      },
      scanner,
      listArgs: args,
      options: { signal, responseTimeoutMs: AI_VAULT_SINGLE_HOST_LIST_TIMEOUT_MS }
    })
  }

  return aiVaultScanIssueResult({
    executionHostId: executionHostScope,
    path: executionHostScope,
    message: 'Agent Session History is not available for this execution host.'
  })
}
