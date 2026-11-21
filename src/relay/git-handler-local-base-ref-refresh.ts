import type { GitExec } from './git-handler-ops'
import { resolve } from 'node:path'
import { expandTilde } from './context'
import { readRelayWorktreeListWithMetadata } from './git-handler-worktree-list'
import { isGitBranchInUse, readGitDirState } from '../shared/git/worktrees/git-worktree-head-state'
import type { GitCapabilityCache } from '../shared/git/commands/git-capability-cache'
import { createCoalescingKeyedRunner } from '../shared/concurrency/coalescing-keyed-runner'
import {
  fastForwardLocalBaseBranch,
  inspectLocalBaseBranch,
  type LocalBaseBranchFastForwardOutcome,
  type LocalBaseBranchGit,
  type LocalBaseBranchInspection,
  type LocalBaseBranchRefs
} from '../shared/worktree/base-refs/local-base-branch-fast-forward'

// Why: the host owns this; one run per branch at a time here also serializes creates from every client of this relay.
const runPerLocalBaseBranch = createCoalescingKeyedRunner<LocalBaseBranchFastForwardOutcome>()

export async function refreshLocalBaseRefForWorktreeCreateOp(
  git: GitExec,
  params: Record<string, unknown>,
  capabilities: GitCapabilityCache
): Promise<LocalBaseBranchFastForwardOutcome> {
  const refs = await readLocalBaseBranchRefs(git, params)
  const host = relayLocalBaseBranchGit(git, capabilities)
  return runPerLocalBaseBranch(
    `${resolve(expandTilde(refs.repoPath))}\0${refs.fullRef}`,
    refs.remoteTrackingRef,
    () => fastForwardLocalBaseBranch(host, refs, { updateCheckedOut: true })
  )
}

export async function inspectLocalBaseRefForWorktreeCreateOp(
  git: GitExec,
  params: Record<string, unknown>,
  capabilities: GitCapabilityCache
): Promise<LocalBaseBranchInspection> {
  const refs = await readLocalBaseBranchRefs(git, params)
  return inspectLocalBaseBranch(relayLocalBaseBranchGit(git, capabilities), refs, {
    reportCheckedOutBlockers: true
  })
}

async function readLocalBaseBranchRefs(
  git: GitExec,
  params: Record<string, unknown>
): Promise<LocalBaseBranchRefs> {
  const { repoPath, fullRef, remoteTrackingRef } = params
  if (
    typeof repoPath !== 'string' ||
    typeof fullRef !== 'string' ||
    typeof remoteTrackingRef !== 'string'
  ) {
    throw new Error('Invalid local base ref refresh request.')
  }
  if (!fullRef.startsWith('refs/heads/') || !remoteTrackingRef.startsWith('refs/remotes/')) {
    throw new Error('Invalid local base ref refresh refs.')
  }
  await git(['check-ref-format', fullRef], repoPath)
  await git(['check-ref-format', remoteTrackingRef], repoPath)
  return { repoPath, fullRef, remoteTrackingRef }
}

function relayLocalBaseBranchGit(
  git: GitExec,
  capabilities: GitCapabilityCache
): LocalBaseBranchGit {
  const listWorktrees = (repoPath: string) =>
    readRelayWorktreeListWithMetadata(git, repoPath, capabilities)
  const commonDirOf = async (repoPath: string): Promise<string> => {
    const { stdout } = await git(['rev-parse', '--git-common-dir'], repoPath)
    // Git paths can end in spaces.
    const commonDir = stdout.replace(/\r?\n$/, '')
    if (!commonDir) {
      throw new Error('Cannot verify the Git common directory.')
    }
    return resolve(expandTilde(repoPath), commonDir)
  }
  return {
    exec: (args, cwd) => git(args, cwd),
    listWorktrees,
    listReservedBranches: async (repoPath) =>
      (await readGitDirState(await commonDirOf(repoPath))).reserved,
    updateRefUnlessInUse: async (repoPath, fullRef, args) => {
      const commonDir = await commonDirOf(repoPath)
      const worktrees = await listWorktrees(repoPath)
      if (worktrees.some((worktree) => worktree.branch === fullRef)) {
        return false
      }
      const bareCommonDir = worktrees[0]?.isBare === true
      let inUse = false
      try {
        await git(args, repoPath, {
          beforeStart: async () => {
            inUse = await isGitBranchInUse(commonDir, fullRef, bareCommonDir)
            return !inUse
          }
        })
      } catch (error) {
        if (inUse) {
          return false
        }
        throw error
      }
      return true
    }
  }
}
