import type {
  AiVaultPrepareSessionResumeArgs,
  AiVaultPrepareSessionResumeResult
} from '../../../../shared/ai-vault/resume/ai-vault-resume-preparation'
import type {
  AiVaultSessionTitleRequest,
  AiVaultSessionTitlesResult
} from '../../../../shared/ai-vault/contracts/ai-vault-session-title'
import type {
  AiVaultListArgs,
  AiVaultListResult
} from '../../../../shared/ai-vault/contracts/ai-vault-types'
import { listAiVaultSessions } from '../../../ai-vault/listing/cached-session-list'
import { listAiVaultSessionsByHost } from '../../../ipc/ai-vault/ai-vault-host-list'
import { deleteAiVaultSessionForRemoteClient } from '../../../ai-vault/deletion/host-session-delete'
import type {
  AiVaultDeleteSessionArgs,
  AiVaultDeleteSessionResult
} from '../../../../shared/ai-vault/contracts/ai-vault-session-deletion'
import { resolveLocalAiVaultSessionTitles } from '../../../ai-vault/session-titles/session-title-resolver'

export class RuntimeAiVaultCommands {
  constructor(
    private readonly getPrepareResume: () =>
      | ((args: AiVaultPrepareSessionResumeArgs) => Promise<AiVaultPrepareSessionResumeResult>)
      | null
  ) {}

  list(args?: AiVaultListArgs, signal?: AbortSignal): Promise<AiVaultListResult> {
    if (args?.executionHostScope && args.executionHostScope !== 'local') {
      return listAiVaultSessionsByHost(args, { signal })
    }
    return listAiVaultSessions(args, { signal })
  }

  resolveTitles(
    requests: AiVaultSessionTitleRequest[],
    signal?: AbortSignal
  ): Promise<AiVaultSessionTitlesResult> {
    return resolveLocalAiVaultSessionTitles(requests, signal)
  }

  delete(
    args: Omit<AiVaultDeleteSessionArgs, 'executionHostId'>
  ): Promise<AiVaultDeleteSessionResult> {
    return deleteAiVaultSessionForRemoteClient(args)
  }

  prepare(args: AiVaultPrepareSessionResumeArgs): Promise<AiVaultPrepareSessionResumeResult> {
    return this.getPrepareResume()?.(args) ?? Promise.resolve({ useRealCodexHome: false })
  }
}
