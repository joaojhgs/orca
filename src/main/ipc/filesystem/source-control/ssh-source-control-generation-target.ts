import type { SshGitProvider } from '../../../providers/ssh-git-provider'
import type { RemoteGenerationTarget } from '../../../text-generation/source-control-text-generation-types'

export function getSshTextGenerationTarget(
  provider: SshGitProvider,
  worktreePath: string
): RemoteGenerationTarget {
  return {
    kind: 'remote',
    cwd: worktreePath,
    execute: (plan, cwd, timeoutMs, operation) =>
      provider.executeCommitMessagePlan(plan, cwd, timeoutMs, operation),
    missingBinaryLocation: 'remote PATH'
  }
}
