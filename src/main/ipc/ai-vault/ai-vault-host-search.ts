import { z } from 'zod'
import {
  searchSessionService,
  sessionSearchServiceStatus
} from '../../ai-vault-search/session-search-service-registry'
import {
  createSessionSearchClient,
  isUnknownSessionSearchMethod,
  unavailableSessionSearchStatus
} from '../../../shared/ai-vault/search/ai-vault-search-client'
import { AiVaultSearchStatusSchema } from '../../../shared/ai-vault/search/ai-vault-search-contract'
import type {
  AiVaultSearchRequest,
  AiVaultSearchResponse,
  AiVaultSearchStatus
} from '../../../shared/ai-vault/search/ai-vault-search-types'
import {
  ALL_EXECUTION_HOSTS_SCOPE,
  LOCAL_EXECUTION_HOST_ID,
  parseRoutableExecutionHostId,
  toSshExecutionHostId,
  type ParsedExecutionHost
} from '../../../shared/execution-host/execution-host'
import { requestActiveSshSessionSearch } from '../ssh/ssh-ai-vault-relay'
import { searchAllExecutionHosts, type SessionSearchHostLeg } from './ai-vault-search-all-hosts'
import {
  getActiveRuntimeAiVaultHostInfosResult,
  getActiveSshAiVaultHostInfosResult
} from './ai-vault-host-list'
import { AI_VAULT_ALL_HOST_TIMEOUT_MS } from './ai-vault-all-host-timeouts'
import {
  OPENS_EVERY_STRUCTURED_CHAT,
  searchWithStructuredOwners
} from '../../ai-vault/structured-sessions/structured-session-ownership'

export type RuntimeSessionSearchCall = (
  environmentId: string,
  method: string,
  params: Record<string, unknown>
) => Promise<unknown>

export type AiVaultHostSearchOptions = {
  callRuntimeSearch?: RuntimeSessionSearchCall
  ensureStructuredSessionOwnership?: () => Promise<void>
}

const UNROUTABLE_HOST_MESSAGE = 'Agent Session History is not available for this execution host.'
// Consent is written where the index lives: locally through settings, never here.
const LOCAL_ENABLE_MESSAGE =
  'Local Agent Session History indexing is changed through Settings, not this channel.'
const SSH_ENABLE_MESSAGE = 'unsupported'
/** Exact text, not a class: the renderer maps this one message to its own copy. */
const HOST_TOO_OLD_MESSAGE = 'host-too-old'
const scopeSchema = z.string().min(1).optional()

let hostSearchOptions: AiVaultHostSearchOptions = {}

export function configureAiVaultHostSearch(options: AiVaultHostSearchOptions): void {
  hostSearchOptions = options
}

export async function searchAiVaultSessionsByHost(
  request: AiVaultSearchRequest,
  rawScope?: unknown
) {
  if (scopeSchema.parse(rawScope) === ALL_EXECUTION_HOSTS_SCOPE) {
    return searchAllExecutionHosts(request, await allExecutionHostLegs())
  }
  return searchByExecutionHostScope(request, requestedSearchScope(rawScope))
}

export async function aiVaultSearchStatusByHost(rawScope?: unknown) {
  return statusByExecutionHost(requestedSearchScope(rawScope))
}

/**
 * Only a paired runtime host can be toggled from here. The local index answers to this
 * desktop's own settings write, and an SSH host has no method to carry the change.
 */
export async function setAiVaultSearchEnabledByHost(
  rawScope: unknown,
  enabled: boolean
): Promise<AiVaultSearchStatus> {
  const scope = requestedSearchScope(rawScope)
  if (scope.kind === 'local') {
    throw new Error(LOCAL_ENABLE_MESSAGE)
  }
  if (scope.kind === 'ssh') {
    throw new Error(SSH_ENABLE_MESSAGE)
  }
  const call = hostSearchOptions.callRuntimeSearch
  if (!call) {
    throw new Error(HOST_TOO_OLD_MESSAGE)
  }
  const { environmentId } = scope
  try {
    return AiVaultSearchStatusSchema.parse(
      await call(environmentId, 'aiVault.setSearchEnabled', { enabled })
    )
  } catch (error) {
    // An old host has no such method; every other refusal is the host's own answer.
    if (isUnknownSessionSearchMethod(error)) {
      throw new Error(HOST_TOO_OLD_MESSAGE)
    }
    throw error
  }
}

/** Reject malformed host IDs; list-scope normalization to all would search unintended hosts. */
function requestedSearchScope(raw: unknown): ParsedExecutionHost {
  const value = scopeSchema.parse(raw)
  if (value === undefined) {
    return { kind: 'local', id: LOCAL_EXECUTION_HOST_ID }
  }
  const parsed = parseRoutableExecutionHostId(value)
  if (!parsed) {
    throw new Error(UNROUTABLE_HOST_MESSAGE)
  }
  return parsed
}

async function searchByExecutionHostScope(
  request: AiVaultSearchRequest,
  scope: ParsedExecutionHost
): Promise<AiVaultSearchResponse> {
  if (scope.kind === 'local') {
    return searchLocalSessions(request)
  }
  const client = remoteSearchClient(scope, hostSearchOptions.callRuntimeSearch)
  if (!client) {
    return { kind: 'unavailable', reason: 'no-service' }
  }
  const response = await client.searchSessions(request)
  // This desktop owns which remote host was addressed.
  return response.kind === 'results'
    ? { ...response, hits: response.hits.map((hit) => ({ ...hit, executionHostId: scope.id })) }
    : response
}

async function searchLocalSessions(request: AiVaultSearchRequest): Promise<AiVaultSearchResponse> {
  return searchWithStructuredOwners(searchSessionService(request, 'ipc'), {
    ensureHost: hostSearchOptions.ensureStructuredSessionOwnership,
    opensChat: OPENS_EVERY_STRUCTURED_CHAT
  })
}

/** One leg per list-visible host; broken enumeration loses only its own host class. */
async function allExecutionHostLegs(): Promise<SessionSearchHostLeg[]> {
  const localLeg: SessionSearchHostLeg = {
    executionHostId: LOCAL_EXECUTION_HOST_ID,
    search: searchLocalSessions
  }
  const [sshHosts, runtimeHosts] = await Promise.all([
    getActiveSshAiVaultHostInfosResult(),
    getActiveRuntimeAiVaultHostInfosResult()
  ])
  const sshLegs = sshHosts.hostInfos.map(({ targetId }) =>
    remoteHostLeg({ kind: 'ssh', id: toSshExecutionHostId(targetId), targetId })
  )
  const runtimeLegs = runtimeHosts.hostInfos.map((hostInfo) =>
    remoteHostLeg({
      kind: 'runtime',
      id: hostInfo.executionHostId,
      environmentId: hostInfo.environmentId
    })
  )
  return [localLeg, ...sshLegs, ...runtimeLegs]
}

function remoteHostLeg(host: ParsedExecutionHost): SessionSearchHostLeg {
  const client = remoteSearchClient(host, hostSearchOptions.callRuntimeSearch)
  return {
    executionHostId: host.id,
    timeoutMs: AI_VAULT_ALL_HOST_TIMEOUT_MS.search,
    search: (request) =>
      client
        ? client.searchSessions(request)
        : Promise.resolve({ kind: 'unavailable', reason: 'no-service' })
  }
}

async function statusByExecutionHost(scope: ParsedExecutionHost): Promise<AiVaultSearchStatus> {
  if (scope.kind === 'local') {
    return sessionSearchServiceStatus({}, 'ipc')
  }
  if (scope.kind === 'runtime') {
    return runtimeHostStatus(scope.environmentId)
  }
  const client = remoteSearchClient(scope, hostSearchOptions.callRuntimeSearch)
  return client ? client.searchStatus() : unavailableSessionSearchStatus()
}

/** Bypass the shared client: distinguish unsupported methods from a current host with indexing disabled. */
async function runtimeHostStatus(environmentId: string): Promise<AiVaultSearchStatus> {
  const call = hostSearchOptions.callRuntimeSearch
  if (!call) {
    return unavailableSessionSearchStatus()
  }
  try {
    return AiVaultSearchStatusSchema.parse(await call(environmentId, 'aiVault.searchStatus', {}))
  } catch (error) {
    if (isUnknownSessionSearchMethod(error)) {
      throw new Error(HOST_TOO_OLD_MESSAGE)
    }
    throw error
  }
}

/** Null for local scope or runtimes without injected transport. */
function remoteSearchClient(
  host: ParsedExecutionHost,
  call: RuntimeSessionSearchCall | undefined
): ReturnType<typeof createSessionSearchClient> | null {
  if (host.kind === 'ssh') {
    return createSessionSearchClient(
      (method, params) => requestActiveSshSessionSearch(host.targetId, method, params),
      'relay'
    )
  }
  if (host.kind === 'runtime' && call) {
    const { environmentId } = host
    // This desktop is a trusted paired client: keep the resume fields its session list already has.
    return createSessionSearchClient(
      (method, params) => call(environmentId, method, params),
      'runtime'
    )
  }
  return null
}
