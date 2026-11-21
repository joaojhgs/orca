import type {
  AiVaultSessionTitlesArgs,
  AiVaultSessionTitlesResult
} from '../../../shared/ai-vault/contracts/ai-vault-session-title'
import {
  LOCAL_EXECUTION_HOST_ID,
  parseRoutableExecutionHostId,
  requestedExecutionHostScope
} from '../../../shared/execution-host/execution-host'
import { resolveLocalAiVaultSessionTitles } from '../../ai-vault/session-titles/session-title-resolver'
import { parseAiVaultSessionTitlesResult } from '../../ai-vault/session-titles/session-title-result-validation'
import { requestActiveSshAiVaultSessionTitles } from '../ssh/ssh-ai-vault-relay'

export type RuntimeAiVaultSessionTitleResolver = (
  environmentId: string,
  args: AiVaultSessionTitlesArgs
) => Promise<AiVaultSessionTitlesResult>

export async function resolveAiVaultSessionTitlesByHost(
  args: AiVaultSessionTitlesArgs,
  resolveRuntime?: RuntimeAiVaultSessionTitleResolver
): Promise<AiVaultSessionTitlesResult> {
  const executionHostScope = requestedExecutionHostScope(args.executionHostScope)
  if (executionHostScope === LOCAL_EXECUTION_HOST_ID) {
    return resolveLocalAiVaultSessionTitles(args.requests)
  }
  const parsed = parseRoutableExecutionHostId(executionHostScope)
  if (parsed?.kind === 'ssh') {
    try {
      const result = await requestActiveSshAiVaultSessionTitles(parsed.targetId, {
        requests: args.requests
      })
      return result === null ? { titles: [] } : parseAiVaultSessionTitlesResult(result)
    } catch {
      return { titles: [] }
    }
  }
  if (parsed?.kind === 'runtime' && resolveRuntime) {
    return resolveRuntime(parsed.environmentId, args).catch(() => ({ titles: [] }))
  }
  return { titles: [] }
}
