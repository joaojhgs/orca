/**
 * Relay-side wiring for the status pass's branch line total.
 * Why: separate file so git-handler-status-ops.ts stays under oxlint max-lines (300).
 */
import {
  computeGitBranchLineTotal,
  GIT_BRANCH_LINE_TOTAL_TIMEOUT_MS
} from '../shared/git/status/git-branch-line-total'
import type { GitExec } from './git-handler-ops'
import type { GitBranchLineTotal } from '../shared/git/status/git-status-types'

/** Undefined when no valid merge base was requested, which keeps the ranged diff entirely off. */
export function buildBranchLineTotalInput(
  git: GitExec,
  worktreePath: string,
  entries: Record<string, unknown>[],
  mergeBase: string | undefined,
  signal?: AbortSignal
):
  | { mergeBase: string; compute: () => Promise<GitBranchLineTotal | null | undefined> }
  | undefined {
  if (!mergeBase) {
    return undefined
  }
  return {
    mergeBase,
    compute: () =>
      computeGitBranchLineTotal({
        worktreePath,
        // Matches the `relay\0<path>` line-stats cache-key convention.
        hostKey: 'relay',
        mergeBase,
        untrackedPaths: entries
          .filter((entry) => entry.area === 'untracked')
          .map((entry) => entry.path as string),
        runDiffNumstat: (args, diffSignal) =>
          git(args, worktreePath, {
            // Why: a working-tree diff must not take index.lock away from terminal Git.
            disableOptionalLocks: true,
            signal: diffSignal,
            timeout: GIT_BRANCH_LINE_TOTAL_TIMEOUT_MS
          }).then(({ stdout }) => stdout),
        ...(signal ? { signal } : {})
      })
  }
}
