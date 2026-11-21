import { ipcMain } from 'electron'
import {
  resolveConflict,
  stageFile,
  unstageFile,
  bulkStageFiles,
  bulkUnstageFiles,
  stageWorktreeChanges
} from '../../../git/source-control/mutations/staging'
import {
  discardChanges,
  bulkDiscardChanges
} from '../../../git/source-control/mutations/discard-changes'
import { resolveRegisteredWorktreePath } from '../../worktrees/removal/registered-worktree-roots-cache'
import {
  getLocalGitOptionsForRegisteredWorktree,
  getLocalRepoForRegisteredWorktree
} from '../../worktrees/local-worktree-runtime-options'
import { getWorktreeSharedLinkPaths } from '../../../git/worktrees/content-paths/worktree-shared-directories'
import { validateGitRelativeFilePath } from '../../../filesystem/local-file-io/filesystem-path-containment'
import type { FilesystemHandlerContext } from '../filesystem-handler-context'
import { parseGitStageWorktreeScope } from '../../../../shared/git/paths/git-stage-worktree-scope'
import { requireFilesystemSshGitProvider } from './filesystem-ssh-git-route'
import { requireReachableGitRoute } from '../../../providers/execution-host-provider-dispatch'
import { getConnectionExecutionHostId } from '../../../../shared/execution-host/execution-host'
import {
  CONFLICT_RESOLUTIONS,
  type ConflictResolution
} from '../../../../shared/source-control/listing/source-control-entry-actions'

export function registerFilesystemGitIndexHandlers(context: FilesystemHandlerContext): void {
  const { store } = context
  ipcMain.handle(
    'git:stage',
    async (
      _event,
      args: { worktreePath: string; filePath: string; connectionId?: string }
    ): Promise<void> => {
      if (args.connectionId) {
        return requireFilesystemSshGitProvider(args.connectionId).stageFile(
          args.worktreePath,
          args.filePath
        )
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const filePath = validateGitRelativeFilePath(worktreePath, args.filePath)
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      await stageFile(worktreePath, filePath, { ...gitOptions, admissionTier: 'interactive' })
    }
  )

  ipcMain.handle(
    'git:resolveConflict',
    async (
      _event,
      args: {
        worktreePath: string
        filePath: string
        resolution: ConflictResolution
        connectionId?: string
      }
    ): Promise<void> => {
      if (!CONFLICT_RESOLUTIONS.includes(args.resolution)) {
        throw new Error('Unknown conflict resolution')
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const filePath = validateGitRelativeFilePath(worktreePath, args.filePath)
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      await resolveConflict(worktreePath, filePath, args.resolution, {
        ...gitOptions,
        admissionTier: 'interactive'
      })
    }
  )

  ipcMain.handle(
    'git:unstage',
    async (
      _event,
      args: { worktreePath: string; filePath: string; connectionId?: string }
    ): Promise<void> => {
      if (args.connectionId) {
        return requireFilesystemSshGitProvider(args.connectionId).unstageFile(
          args.worktreePath,
          args.filePath
        )
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const filePath = validateGitRelativeFilePath(worktreePath, args.filePath)
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      await unstageFile(worktreePath, filePath, { ...gitOptions, admissionTier: 'interactive' })
    }
  )

  ipcMain.handle(
    'git:discard',
    async (
      _event,
      args: { worktreePath: string; filePath: string; connectionId?: string }
    ): Promise<void> => {
      if (args.connectionId) {
        return requireFilesystemSshGitProvider(args.connectionId).discardChanges(
          args.worktreePath,
          args.filePath
        )
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const filePath = validateGitRelativeFilePath(worktreePath, args.filePath)
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      await discardChanges(worktreePath, filePath, { ...gitOptions, admissionTier: 'interactive' })
    }
  )

  ipcMain.handle(
    'git:bulkDiscard',
    async (
      _event,
      args: { worktreePath: string; filePaths: string[]; connectionId?: string }
    ): Promise<void> => {
      if (args.connectionId) {
        return requireFilesystemSshGitProvider(args.connectionId).bulkDiscardChanges(
          args.worktreePath,
          args.filePaths
        )
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const filePaths = args.filePaths.map((p) => validateGitRelativeFilePath(worktreePath, p))
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      await bulkDiscardChanges(worktreePath, filePaths, {
        ...gitOptions,
        admissionTier: 'interactive'
      })
    }
  )

  ipcMain.handle(
    'git:bulkStage',
    async (
      _event,
      args: { worktreePath: string; filePaths: string[]; connectionId?: string; scope?: unknown }
    ): Promise<void> => {
      const scope = parseGitStageWorktreeScope(args.scope)
      if (args.connectionId) {
        return requireFilesystemSshGitProvider(args.connectionId).bulkStageFiles(
          args.worktreePath,
          args.filePaths,
          scope
        )
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const filePaths = args.filePaths.map((p) => validateGitRelativeFilePath(worktreePath, p))
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      if (scope) {
        const repo = getLocalRepoForRegisteredWorktree(store, args.worktreePath, worktreePath)
        await stageWorktreeChanges(worktreePath, scope, {
          ...gitOptions,
          admissionTier: 'interactive',
          sharedLinkPaths: repo ? getWorktreeSharedLinkPaths(repo) : []
        })
        return
      }
      await bulkStageFiles(worktreePath, filePaths, {
        ...gitOptions,
        admissionTier: 'interactive'
      })
    }
  )

  ipcMain.handle(
    'git:bulkUnstage',
    async (
      _event,
      args: { worktreePath: string; filePaths: string[]; connectionId?: string }
    ): Promise<void> => {
      if (args.connectionId) {
        return requireFilesystemSshGitProvider(args.connectionId).bulkUnstageFiles(
          args.worktreePath,
          args.filePaths
        )
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const filePaths = args.filePaths.map((p) => validateGitRelativeFilePath(worktreePath, p))
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      await bulkUnstageFiles(worktreePath, filePaths, {
        ...gitOptions,
        admissionTier: 'interactive'
      })
    }
  )
}
