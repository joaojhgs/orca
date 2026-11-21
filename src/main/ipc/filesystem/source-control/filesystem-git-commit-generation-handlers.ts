import {
  textGenerationFailure,
  textGenerationFailureCodeFields
} from '../../../../shared/text-generation/text-generation-failure-copy'
import { ipcMain } from 'electron'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import type { ResolvedSourceControlAiGenerationParams } from '../../../../shared/source-control/ai/source-control-ai-operation-resolution'
import {
  cancelGenerateCommitMessageLocal,
  generateCommitMessageFromContext,
  resolveCommitMessageSettings
} from '../../../text-generation/commit-message-text-generation'
import type { GenerateCommitMessageResult } from '../../../text-generation/source-control-text-generation-types'
import { getCommitMessageModelDiscoveryHostKey } from '../../../../shared/source-control/ai/generation/commit-message-host-key'
import { getStagedCommitContext } from '../../../git/source-control/mutations/staged-commit-context'
import {
  getSshGitProvider,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
} from '../../../providers/ssh-git-dispatch'
import { getSshTextGenerationTarget } from './ssh-source-control-generation-target'
import { resolveRegisteredWorktreePath } from '../../worktrees/removal/registered-worktree-roots-cache'
import { getLocalGitOptionsForRegisteredWorktree } from '../../worktrees/local-worktree-runtime-options'
import { withLinkedIssueDraftContext } from '../../../../shared/source-control/ai/recipes/source-control-ai-action-variables'
import { resolveSourceControlAiLinkedIssue } from '../../source-control/source-control-ai-linked-issue'
import { prepareLocalCommitMessageAgentEnv } from '../../../text-generation/execution/commit-message-agent-environment'
import {
  CANCELED_GENERATION_RESULT,
  runCancelableLocalGeneration
} from '../../../text-generation/execution/source-control-generation-lanes'
import type { FilesystemHandlerContext } from '../filesystem-handler-context'
import {
  getLocalAgentRuntimeTarget,
  getLocalTextGenerationTarget,
  getRepoForSourceControlAi
} from './filesystem-source-control-ai-targets'

export function registerFilesystemGitCommitGenerationHandlers(
  context: FilesystemHandlerContext
): void {
  const { store, commitMessageAgentEnv } = context
  ipcMain.handle(
    'git:generateCommitMessage',
    async (
      _event,
      args: {
        worktreePath: string
        // Raw (unstripped) meta key; validated against worktreePath before any meta read.
        worktreeId?: string
        repoId?: string
        connectionId?: string
        sourceControlAiResolvedParams?: ResolvedSourceControlAiGenerationParams
        sourceControlAi?: GlobalSettings['sourceControlAi']
        agentCmdOverrides?: GlobalSettings['agentCmdOverrides']
      }
    ): Promise<GenerateCommitMessageResult> => {
      const discoveryHostKey = getCommitMessageModelDiscoveryHostKey(args.connectionId ?? null)
      const baseSettings = store.getSettings()
      const requestSettings = {
        ...baseSettings,
        ...(args.sourceControlAi !== undefined ? { sourceControlAi: args.sourceControlAi } : {}),
        ...(args.agentCmdOverrides !== undefined
          ? { agentCmdOverrides: args.agentCmdOverrides }
          : {})
      }
      const resolvedSettings = args.sourceControlAiResolvedParams
        ? { ok: true as const, params: args.sourceControlAiResolvedParams }
        : resolveCommitMessageSettings(
            requestSettings,
            discoveryHostKey,
            'commitMessage',
            await getRepoForSourceControlAi(store, args)
          )
      if (!resolvedSettings.ok) {
        return {
          success: false,
          error: resolvedSettings.error,
          ...textGenerationFailureCodeFields(resolvedSettings)
        }
      }
      if (args.connectionId) {
        const provider = getSshGitProvider(args.connectionId)
        if (!provider) {
          return {
            success: false,
            error: SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
          }
        }
        let context
        try {
          context = await provider.getStagedCommitContext(args.worktreePath)
        } catch (error) {
          console.error('[filesystem] Failed to read remote staged commit context:', error)
          return {
            success: false,
            ...textGenerationFailure('stagedChangesReadFailed')
          }
        }
        if (!context) {
          return { success: false, ...textGenerationFailure('noStagedChanges') }
        }
        context = withLinkedIssueDraftContext(
          context,
          resolveSourceControlAiLinkedIssue(store, args)
        )
        return generateCommitMessageFromContext(
          context,
          resolvedSettings.params,
          getSshTextGenerationTarget(provider, args.worktreePath)
        )
      }
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      return runCancelableLocalGeneration<GenerateCommitMessageResult>(
        'commit-message',
        worktreePath,
        async (isCanceled) => {
          let context
          try {
            context = await getStagedCommitContext(worktreePath, {
              ...gitOptions,
              admissionTier: 'interactive'
            })
          } catch (error) {
            console.error('[filesystem] Failed to read staged commit context:', error)
            return {
              success: false,
              ...textGenerationFailure('stagedChangesReadFailed')
            }
          }
          if (!context) {
            return { success: false, ...textGenerationFailure('noStagedChanges') }
          }
          context = withLinkedIssueDraftContext(
            context,
            resolveSourceControlAiLinkedIssue(store, args, worktreePath)
          )
          const localEnv = await prepareLocalCommitMessageAgentEnv(
            resolvedSettings.params.agentId,
            commitMessageAgentEnv,
            getLocalAgentRuntimeTarget(gitOptions)
          )
          if (!localEnv.ok) {
            return { success: false, error: localEnv.error }
          }
          if (isCanceled()) {
            return CANCELED_GENERATION_RESULT
          }
          return generateCommitMessageFromContext(
            context,
            resolvedSettings.params,
            getLocalTextGenerationTarget(worktreePath, gitOptions, localEnv.env)
          )
        }
      )
    }
  )

  ipcMain.handle(
    'git:cancelGenerateCommitMessage',
    async (_event, args: { worktreePath: string; connectionId?: string }): Promise<void> => {
      if (args.connectionId) {
        await getSshGitProvider(args.connectionId)?.cancelGenerateCommitMessage(
          args.worktreePath,
          'commit-message'
        )
        return
      }
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      cancelGenerateCommitMessageLocal(worktreePath)
    }
  )
}
