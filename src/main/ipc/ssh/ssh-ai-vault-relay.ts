import {
  AiVaultSearchRequestSchema,
  AiVaultSearchStatusRequestSchema
} from '../../../shared/ai-vault/search/ai-vault-search-contract'
import type {
  SshAiVaultRelayListParams,
  SshAiVaultRelayTitleParams
} from '../../../shared/ssh-ai-vault-relay'
import { isOwnedSshTargetId } from '../../../shared/execution-host/execution-host'
import type { SshRelayAiVaultHostInfo } from '../../ssh/ssh-relay-session'
import { activeSessions } from './ssh-active-relay-sessions'

export function getActiveSshAiVaultHostInfo(targetId: string): SshRelayAiVaultHostInfo | null {
  if (isOwnedSshTargetId(targetId)) {
    return null
  }
  return activeSessions.get(targetId)?.getAiVaultHostInfo() ?? null
}

export function getActiveSshAiVaultHostInfos(): SshRelayAiVaultHostInfo[] {
  return [...activeSessions.values()].flatMap((session) => {
    if (isOwnedSshTargetId(session.targetId)) {
      return []
    }
    const info = session.getAiVaultHostInfo()
    return info ? [info] : []
  })
}

export async function requestActiveSshSessionSearch(
  targetId: string,
  method: string,
  params: unknown
): Promise<unknown> {
  if (isOwnedSshTargetId(targetId)) {
    throw new Error('SSH target belongs to another runtime')
  }
  const session = activeSessions.get(targetId)
  if (!session) {
    throw new Error('SSH relay is not ready')
  }
  if (method === 'aiVault.searchSessions') {
    return session.requestSessionSearch(method, AiVaultSearchRequestSchema.parse(params))
  }
  if (method === 'aiVault.searchStatus') {
    return session.requestSessionSearch(method, AiVaultSearchStatusRequestSchema.parse(params))
  }
  throw new Error('Unknown session search method')
}

export async function requestActiveSshAiVaultSessionList(
  targetId: string,
  params: SshAiVaultRelayListParams,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<unknown> {
  if (isOwnedSshTargetId(targetId)) {
    return null
  }
  const session = activeSessions.get(targetId)
  if (!session) {
    throw new Error('SSH relay is not ready')
  }
  return session.requestAiVaultSessionList(params, options)
}

export async function requestActiveSshAiVaultSessionTitles(
  targetId: string,
  params: SshAiVaultRelayTitleParams,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<unknown> {
  if (isOwnedSshTargetId(targetId)) {
    return null
  }
  const session = activeSessions.get(targetId)
  if (!session) {
    throw new Error('SSH relay is not ready')
  }
  return session.requestAiVaultSessionTitles(params, options)
}
