import { captureRuntimeAiVaultProjectionDependency } from './ai-vault-projection-dependency'
import { resetAiVaultSessionListCacheForTests } from '../../ai-vault/listing/cached-session-list'
import {
  AI_VAULT_SCOPE_PATHS_MAX_COUNT,
  type AiVaultListArgs,
  type AiVaultListResult
} from '../../../shared/ai-vault/contracts/ai-vault-types'
import {
  LOCAL_EXECUTION_HOST_ID,
  parseRoutableExecutionHostId,
  requestedExecutionHostScope
} from '../../../shared/execution-host/execution-host'
import { getSshConnectionGeneration } from '../../ssh/connection/authority/ssh-connection-generation'
import type { SshRelayAiVaultHostInfo } from '../../ssh/ssh-relay-session'
import {
  getActiveSshAiVaultHostInfos,
  getActiveSshAiVaultHostInfo
} from '../ssh/ssh-ai-vault-relay'
import { discoverAiVaultHosts, type AiVaultHostDiscoveryResult } from './ai-vault-host-discovery'
import type {
  RuntimeAiVaultHostInfo,
  RuntimeAiVaultScanner
} from '../../ai-vault/runtime-hosts/ai-vault-runtime-scan'
import {
  createAiVaultListScanCoordinator,
  resetAiVaultHostLegCacheForTests,
  scanHostLegWithCache
} from './ai-vault-host-leg-cache'
import { requestedAiVaultSessionDepth } from '../../../shared/ai-vault/scanning/ai-vault-session-depth'
import {
  scanAiVaultSessionsByHostScope,
  type AiVaultScanHostScope
} from './ai-vault-host-scope-scan'

export type AiVaultHostListOptions = {
  getUserDataPath?: () => string
  getActiveRuntimeAiVaultHostInfos?: () =>
    | readonly RuntimeAiVaultHostInfo[]
    | Promise<readonly RuntimeAiVaultHostInfo[]>
  scanRuntimeAiVaultSessions?: RuntimeAiVaultScanner
}

let scanCoordinator = createAiVaultListScanCoordinator()
let hostListOptions: AiVaultHostListOptions = {}

export function configureAiVaultHostList(options: AiVaultHostListOptions): void {
  hostListOptions = options
}

export async function listAiVaultSessionsByHost(
  args?: AiVaultListArgs,
  options: { signal?: AbortSignal } = {}
): Promise<AiVaultListResult> {
  const executionHostScope = requestedExecutionHostScope(args?.executionHostScope)
  const hostScope: AiVaultScanHostScope =
    executionHostScope === 'all'
      ? {
          scope: executionHostScope,
          runtimeHosts: await getActiveRuntimeAiVaultHostInfosResult(),
          sshHosts: await getActiveSshAiVaultHostInfosResult()
        }
      : { scope: executionHostScope }
  const parsedHost = parseRoutableExecutionHostId(executionHostScope)
  const sshHosts =
    hostScope.scope === 'all'
      ? hostScope.sshHosts.hostInfos
      : parsedHost?.kind === 'ssh' && getActiveSshAiVaultHostInfo(parsedHost.targetId)
        ? [{ targetId: parsedHost.targetId }]
        : []
  const dependency = await captureRuntimeAiVaultProjectionDependency(
    hostScope.scope === 'all'
      ? hostScope.runtimeHosts.hostInfos.map((host) => host.environmentId)
      : parsedHost?.kind === 'runtime'
        ? [parsedHost.environmentId]
        : [],
    hostListOptions.getUserDataPath
  )
  // Canonicalize bounded workspace sets so equivalent scopes share a scan.
  const scopePaths = args?.scopePaths ?? []
  const key = JSON.stringify({
    scopePaths:
      scopePaths.length <= AI_VAULT_SCOPE_PATHS_MAX_COUNT
        ? [...new Set(scopePaths)].sort()
        : scopePaths,
    executionHostScope,
    sshHosts: sshHosts
      .map(({ targetId }) => [targetId, getSshConnectionGeneration(targetId)] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
    includeAntigravityIdeSessions: args?.includeAntigravityIdeSessions === true,
    ...(args?.scopeOnly === true ? { scopeOnly: true } : {})
  })
  const depth = requestedAiVaultSessionDepth(args)
  const afterFingerprint = parsedHost?.kind === 'runtime' ? args?.afterFingerprint : undefined
  // Why: every renderer request carries its own cancellation signal, so
  // coalescing has to survive them — the coordinator hands all same-key callers
  // one scan and only aborts it once every one of them has cancelled.
  return scanCoordinator
    .run({
      key: JSON.stringify({ key, depth, afterFingerprint, projection: dependency.key }),
      force: args?.force,
      signal: options.signal,
      start: (scanSignal) => {
        const scan = () =>
          scanAiVaultSessionsByHostScope(
            args,
            hostScope,
            scanSignal,
            key,
            dependency,
            hostListOptions.scanRuntimeAiVaultSessions
          )
        if (executionHostScope === LOCAL_EXECUTION_HOST_ID) {
          return scan()
        }
        return scanHostLegWithCache({
          cacheKey: key,
          dependency,
          depth,
          scopePaths,
          force: args?.force === true,
          afterFingerprint,
          scan
        })
      }
    })
    .finally(dependency.release)
}

export async function getActiveRuntimeAiVaultHostInfosResult(): Promise<
  AiVaultHostDiscoveryResult<RuntimeAiVaultHostInfo>
> {
  return discoverAiVaultHosts(() => hostListOptions.getActiveRuntimeAiVaultHostInfos?.() ?? [], {
    path: 'runtime environments',
    fallbackMessage: 'Runtime hosts are unavailable.'
  })
}

export function getActiveSshAiVaultHostInfosResult(): Promise<
  AiVaultHostDiscoveryResult<SshRelayAiVaultHostInfo>
> {
  return discoverAiVaultHosts(getActiveSshAiVaultHostInfos, {
    path: 'SSH hosts',
    fallbackMessage: 'SSH hosts are unavailable.'
  })
}

export function resetAiVaultHostListForTests(): void {
  resetAiVaultHostLegCacheForTests()
  scanCoordinator = createAiVaultListScanCoordinator()
  hostListOptions = {}
  // Keep tests isolated from the shared local-leg cache.
  resetAiVaultSessionListCacheForTests()
}
