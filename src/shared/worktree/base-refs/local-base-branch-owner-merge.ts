import { readGitCommandFailureText } from '../../git/commands/git-command-failure-text'
import type { LocalBaseRefRefreshResult } from './base-ref-drift-types'

// Force a plain fast-forward without hooks, auto-GC, autostash, branch mergeOptions, signature refusal or ignored-file overwrite. Flags override config; older Git ignores unknown keys.
// /dev/null/<hook> never exists. Git 2.25 has neither ort nor --no-autostash.
export function ownerFastForwardArgs(branch: string, targetOid: string): string[] {
  return [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'gc.auto=0',
    '-c',
    'maintenance.auto=false',
    '-c',
    'merge.autoStash=false',
    '-c',
    `branch.${branch}.mergeOptions=`,
    'merge',
    '--ff-only',
    '-s',
    'recursive',
    '--no-verify-signatures',
    '--no-overwrite-ignore',
    '--no-stat',
    '-q',
    targetOid
  ]
}

export function classifyOwnerFastForwardFailure(
  error: unknown
): Exclude<LocalBaseRefRefreshResult['status'], 'updated'> {
  const text = readGitCommandFailureText(error)
  if (/would be overwritten by merge|would lose untracked files/i.test(text)) {
    return 'skipped_dirty_worktree'
  }
  if (/Not possible to fast-forward/i.test(text)) {
    return 'skipped_not_fast_forward'
  }
  return 'skipped_error'
}
