import { app, ipcMain } from 'electron'
import {
  configureAiVaultSessionSources,
  type AiVaultSessionSources
} from '../../ai-vault/discovery/ai-vault-scan-roots'
import { deleteAiVaultSession, registerAiVaultDeleteHandler } from './ai-vault-delete'
import { listAiVaultSubagentSessions } from './ai-vault-subagent-list'
import { cancelledAiVaultListResult } from '../../ai-vault/listing/session-list-results'
import type { AiVaultDeleteSessionArgs } from '../../../shared/ai-vault/contracts/ai-vault-session-deletion'
import {
  isAiVaultScanCancelledError,
  type AiVaultFirstUserPromptArgs,
  type AiVaultListArgs,
  type AiVaultSubagentListArgs,
  type AiVaultSubagentListResult
} from '../../../shared/ai-vault/contracts/ai-vault-types'
import { handleAiVaultGetFirstUserPrompt } from '../../ai-vault/prompts/session-first-user-prompt-handler'
import { registerAiVaultResumeHandler, type AiVaultResumeHandlerOptions } from './ai-vault-resume'
import { createSenderScopedRequestCancellations } from '../renderer-requests/sender-scoped-request-cancellation'
import { invalidateAiVaultHostLegCache } from './ai-vault-host-leg-cache'
import type {
  AiVaultSessionTitlesArgs,
  AiVaultSessionTitlesResult
} from '../../../shared/ai-vault/contracts/ai-vault-session-title'
import {
  resolveAiVaultSessionTitlesByHost,
  type RuntimeAiVaultSessionTitleResolver
} from './ai-vault-session-title-routing'
import {
  OPENS_EVERY_STRUCTURED_CHAT,
  projectStructuredAiVaultSessions
} from '../../ai-vault/structured-sessions/structured-session-ownership'
import { registerAiVaultScanProgressBroadcast } from './ai-vault-scan-progress-broadcast'
import {
  configureAiVaultHostList,
  listAiVaultSessionsByHost,
  resetAiVaultHostListForTests,
  type AiVaultHostListOptions
} from './ai-vault-host-list'

type AiVaultHandlerOptions = AiVaultSessionSources &
  AiVaultResumeHandlerOptions &
  AiVaultHostListOptions & {
    resolveRuntimeAiVaultSessionTitles?: RuntimeAiVaultSessionTitleResolver
  }

let handlerOptions: AiVaultHandlerOptions = {}
const listCancellations = createSenderScopedRequestCancellations()
// Deletion must invalidate the shared multi-host list cache.
const aiVaultDeleteDeps = {
  invalidateMultiHostListCache: invalidateAiVaultHostLegCache
}

const resolveAiVaultSessionTitles = (
  args: AiVaultSessionTitlesArgs
): Promise<AiVaultSessionTitlesResult> =>
  resolveAiVaultSessionTitlesByHost(args, handlerOptions.resolveRuntimeAiVaultSessionTitles)

export function registerAiVaultHandlers(options: AiVaultHandlerOptions = {}): void {
  handlerOptions = options
  configureAiVaultHostList(options)
  // Configure the same source/cache instance used by runtime RPC and headless serve.
  configureAiVaultSessionSources(options)
  ipcMain.handle('aiVault:listSessions', async (event, args?: AiVaultListArgs) => {
    const requestToken =
      typeof args?.requestToken === 'string' && args.requestToken.length <= 128
        ? args.requestToken
        : undefined
    const controller = listCancellations.begin(event, requestToken)
    try {
      await handlerOptions.ensureStructuredSessionOwnership?.()
      const result = await listAiVaultSessionsByHost(args, { signal: controller?.signal })
      return projectStructuredAiVaultSessions(result, OPENS_EVERY_STRUCTURED_CHAT)
    } catch (error) {
      // Expected cancellation is a result so Electron does not log rejected IPC as an error.
      if (!isAiVaultScanCancelledError(error)) {
        throw error
      }
      return cancelledAiVaultListResult()
    } finally {
      listCancellations.finish(event, requestToken, controller)
    }
  })
  ipcMain.handle(
    'aiVault:resolveSessionTitles',
    (_event, args: AiVaultSessionTitlesArgs): Promise<AiVaultSessionTitlesResult> =>
      resolveAiVaultSessionTitles(args)
  )
  ipcMain.handle(
    'aiVault:cancelListSessions',
    (event, args: { requestToken?: string } | undefined): void => {
      if (typeof args?.requestToken === 'string' && args.requestToken.length <= 128) {
        listCancellations.cancel(event, args.requestToken)
      }
    }
  )
  registerAiVaultResumeHandler(options)
  ipcMain.handle(
    'aiVault:listSubagentSessions',
    (_event, args?: AiVaultSubagentListArgs): Promise<AiVaultSubagentListResult> =>
      listAiVaultSubagentSessions(args)
  )
  ipcMain.handle('aiVault:getFirstUserPrompt', (_event, args?: AiVaultFirstUserPromptArgs) =>
    handleAiVaultGetFirstUserPrompt(args)
  )
  registerAiVaultDeleteHandler(aiVaultDeleteDeps)
  registerAiVaultScanProgressBroadcast()
  // macOS app activation skips DOM focus events, so emit the refresh signal here.
  app.on('browser-window-focus', (_event, window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('aiVault:windowFocused')
    }
  })
}

function resetAiVaultCacheForTests(): void {
  handlerOptions = {}
  resetAiVaultHostListForTests()
}

export const _internals = {
  listAiVaultSessions: listAiVaultSessionsByHost,
  resolveAiVaultSessionTitles,
  listAiVaultSubagentSessions,
  deleteAiVaultSession: (args?: AiVaultDeleteSessionArgs) =>
    deleteAiVaultSession(args, aiVaultDeleteDeps),
  resetAiVaultCacheForTests
}
