import { isWindowsAbsolutePathLike } from '../../../../shared/file-access/cross-platform-path'
import type { Repo } from '../../../../shared/repository/repo-types'
import { getEffectiveHooksFromConfig } from '../../../workspace-hooks/effective-hook-config'
import { parseOrcaYaml } from '../../../../shared/workspace-setup/orca-yaml'
import type { IFilesystemProvider } from '../../../providers/types'
import { joinWorktreeRelativePath } from '../../../runtime/files/paths/runtime-relative-paths'
import { getSetupRunnerEnvVars } from '../../../workspace-hooks/setup-hook-env-vars'
import {
  ARCHIVE_HOOK_TIMEOUT_MS,
  type ArchiveHookRunResult
} from '../../../../shared/worktree/removal/archive-hook-removal-gate'
import type { DirectSshWorktreeAuthority } from '../direct-ssh-worktree-authority'

export async function readDirectSshOrcaYaml(
  provider: IFilesystemProvider | undefined,
  path: string
): Promise<ReturnType<typeof parseOrcaYaml>> {
  if (!provider) {
    return null
  }
  try {
    const result = await provider.readFile(joinWorktreeRelativePath(path, 'orca.yaml'))
    return result.isBinary ? null : parseOrcaYaml(result.content)
  } catch {
    return null
  }
}

export async function readDirectSshHooks(repo: Repo, provider?: IFilesystemProvider) {
  return getEffectiveHooksFromConfig(repo, await readDirectSshOrcaYaml(provider, repo.path))
}

export async function runDirectSshArchiveHook(
  ssh: DirectSshWorktreeAuthority,
  repo: Repo,
  worktreePath: string,
  script: string
): Promise<ArchiveHookRunResult> {
  ssh.assertCurrent()
  const env = getSetupRunnerEnvVars(repo, worktreePath)
  const isWindowsRemote = isWindowsAbsolutePathLike(worktreePath)
  const result = await ssh.provider
    .execNonInteractive(
      isWindowsRemote ? 'cmd.exe' : '/bin/bash',
      isWindowsRemote ? ['/d', '/s', '/c', script] : ['-lc', script],
      worktreePath,
      ARCHIVE_HOOK_TIMEOUT_MS,
      undefined,
      env
    )
    .catch((error) => ({
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: false,
      spawnError: error instanceof Error ? error.message : String(error)
    }))
  const output = [
    result.stdout,
    result.stderr,
    result.spawnError,
    result.timedOut ? 'archive hook timed out' : null,
    typeof result.exitCode === 'number' && result.exitCode !== 0
      ? `archive hook exited ${result.exitCode}`
      : null
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n')
    .trim()

  // Why (#19334): a spawn error or timeout means the host never reported an exit for this run, so
  // the code is withheld and the gate classifies the failure `unverifiable` rather than `exited`.
  const observedExit =
    !result.spawnError && !result.timedOut && typeof result.exitCode === 'number'
      ? result.exitCode
      : undefined
  return {
    success: observedExit === 0,
    output,
    ...(observedExit !== undefined ? { exitCode: observedExit } : {})
  }
}
