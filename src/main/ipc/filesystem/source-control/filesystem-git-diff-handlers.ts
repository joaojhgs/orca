import { getDiff } from '../../../git/source-control/diffs/file-diff'
import { ipcMain } from 'electron'
import type { GitDiffResult } from '../../../../shared/git/diff/git-diff-compare-types'
import { getBranchDiff } from '../../../git/source-control/comparisons/branch-diff'
import { getCommitDiff } from '../../../git/source-control/comparisons/commit-diff'
import {
  validateFullGitObjectId,
  validateGitRelativeFilePath,
  validateGitRelativeFilePathAsync
} from '../../../filesystem/local-file-io/filesystem-path-containment'
import type { FilesystemHandlerContext } from '../filesystem-handler-context'
import { requireFilesystemSshGitProvider } from './filesystem-ssh-git-route'
import { requireReachableGitRoute } from '../../../providers/execution-host-provider-dispatch'
import { getConnectionExecutionHostId } from '../../../../shared/execution-host/execution-host'
import { readWorktreeGitUnlessWslStopped } from './wsl-gated-worktree-git-read'

export function registerFilesystemGitDiffHandlers(context: FilesystemHandlerContext): void {
  const { store } = context
  ipcMain.handle(
    'git:branchDiff',
    async (
      _event,
      args: {
        worktreePath: string
        compare: {
          baseRef: string
          baseOid: string
          headOid: string
          mergeBase: string
        }
        filePath: string
        oldPath?: string
        connectionId?: string
        /** Showing the diff tab or its Retry: a user act that may start a stopped WSL distro. */
        wakeWslDistro?: boolean
      }
    ): Promise<GitDiffResult> => {
      if (args.connectionId) {
        const results = await requireFilesystemSshGitProvider(args.connectionId).getBranchDiff(
          args.worktreePath,
          args.compare.mergeBase,
          {
            includePatch: true,
            headOid: args.compare.headOid,
            filePath: args.filePath,
            oldPath: args.oldPath
          }
        )
        return (
          results[0] ?? {
            kind: 'text',
            originalContent: '',
            modifiedContent: '',
            originalIsBinary: false,
            modifiedIsBinary: false
          }
        )
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      return readWorktreeGitUnlessWslStopped(
        store,
        args.worktreePath,
        args.wakeWslDistro,
        (worktreePath, gitOptions) =>
          getBranchDiff(
            worktreePath,
            {
              mergeBase: args.compare.mergeBase,
              headOid: args.compare.headOid,
              filePath: validateGitRelativeFilePath(worktreePath, args.filePath),
              oldPath: args.oldPath
                ? validateGitRelativeFilePath(worktreePath, args.oldPath)
                : undefined
            },
            { ...gitOptions, admissionTier: 'interactive' }
          )
      )
    }
  )

  ipcMain.handle(
    'git:commitDiff',
    async (
      _event,
      args: {
        worktreePath: string
        commitOid: string
        parentOid?: string | null
        filePath: string
        oldPath?: string
        connectionId?: string
        /** Showing the diff tab or its Retry: a user act that may start a stopped WSL distro. */
        wakeWslDistro?: boolean
      }
    ): Promise<GitDiffResult> => {
      const commitOid = validateFullGitObjectId(args.commitOid, 'commitOid')
      const parentOid = args.parentOid ? validateFullGitObjectId(args.parentOid, 'parentOid') : null
      if (args.connectionId) {
        return requireFilesystemSshGitProvider(args.connectionId).getCommitDiff(args.worktreePath, {
          commitOid,
          parentOid,
          filePath: args.filePath,
          oldPath: args.oldPath
        })
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      return readWorktreeGitUnlessWslStopped(
        store,
        args.worktreePath,
        args.wakeWslDistro,
        (worktreePath, gitOptions) =>
          getCommitDiff(
            worktreePath,
            {
              commitOid,
              parentOid,
              filePath: validateGitRelativeFilePath(worktreePath, args.filePath),
              oldPath: args.oldPath
                ? validateGitRelativeFilePath(worktreePath, args.oldPath)
                : undefined
            },
            { ...gitOptions, admissionTier: 'interactive' }
          )
      )
    }
  )

  ipcMain.handle(
    'git:diff',
    async (
      _event,
      args: {
        worktreePath: string
        filePath: string
        staged: boolean
        compareAgainstHead?: boolean
        oldPath?: string
        connectionId?: string
        /** Showing the diff tab or its Retry: a user act that may start a stopped WSL distro. */
        wakeWslDistro?: boolean
      }
    ): Promise<GitDiffResult> => {
      if (args.connectionId) {
        return requireFilesystemSshGitProvider(args.connectionId).getDiff(
          args.worktreePath,
          args.filePath,
          args.staged,
          args.compareAgainstHead
        )
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      return readWorktreeGitUnlessWslStopped(
        store,
        args.worktreePath,
        args.wakeWslDistro,
        async (worktreePath, gitOptions) =>
          getDiff(
            worktreePath,
            validateGitRelativeFilePath(worktreePath, args.filePath),
            args.staged,
            args.compareAgainstHead,
            {
              ...gitOptions,
              admissionTier: 'interactive',
              ...(args.oldPath
                ? { oldPath: await validateGitRelativeFilePathAsync(worktreePath, args.oldPath) }
                : {})
            }
          )
      )
    }
  )
}
