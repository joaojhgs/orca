import { posix, win32 } from 'node:path'
import type { Repo } from '../../../../shared/repository/repo-types'
import type {
  CreateWorktreeResult,
  SetupTrustMismatch
} from '../../../../shared/worktree/create-types'
import { isWindowsAbsolutePathLike } from '../../../../shared/file-access/cross-platform-path'
import type { SetupAgentStartupPolicy } from '../../../../shared/workspace-setup/orca-yaml-hook-types'
import { shouldWaitForSetupBeforeAgentStartup } from '../../../../shared/agent-launch/startup/setup-agent-startup-policy'
import { getSshFilesystemProvider } from '../../../providers/ssh-filesystem-dispatch'
import type { IFilesystemProvider } from '../../../providers/types'
import type { WorktreeCreateTimingRecorder } from '../../../workspaces/creation/worktree-create-timing'
import {
  getDefaultTabsLaunch,
  getEffectiveHooksFromConfig,
  shouldRunSetupForCreate
} from '../../../workspace-hooks/effective-hook-config'
import {
  checkCreatedWorktreeSetupTrust,
  defaultTabsWithoutCommands
} from '../../../workspace-hooks/created-worktree-setup-trust'
import {
  buildPosixRunnerScript,
  buildWindowsRunnerScript
} from '../../../workspace-hooks/setup-runner-script-text'
import { getSetupRunnerEnvVars } from '../../../workspace-hooks/setup-hook-env-vars'
import { readDirectSshOrcaYaml } from '../removal/direct-ssh-archive-hooks'
import type { DirectSshWorktreeAuthority } from '../direct-ssh-worktree-authority'
import type { CreateWorktreeArgsWithSystemProvenance } from '../worktree-remote'

export async function prepareDirectSshCreatedWorktreeSetup(
  args: CreateWorktreeArgsWithSystemProvenance,
  repo: Repo,
  worktreePath: string,
  ssh: DirectSshWorktreeAuthority,
  fsProvider: IFilesystemProvider | undefined,
  timing: WorktreeCreateTimingRecorder
) {
  let setup: CreateWorktreeResult['setup']
  let defaultTabs: CreateWorktreeResult['defaultTabs']
  let setupTrustMismatch: SetupTrustMismatch | undefined
  if (fsProvider) {
    await timing.time('prepare_setup', async () => {
      const yamlHooks = await readDirectSshOrcaYaml(fsProvider, worktreePath)
      setupTrustMismatch = checkCreatedWorktreeSetupTrust(repo, yamlHooks, args.setupDecision, args)
      const setupDecision = setupTrustMismatch ? 'skip' : args.setupDecision
      const hooks = getEffectiveHooksFromConfig(repo, yamlHooks)
      try {
        const launch = getDefaultTabsLaunch(yamlHooks, repo, setupDecision)
        defaultTabs = setupTrustMismatch ? defaultTabsWithoutCommands(launch) : launch
      } catch (error) {
        // Why: default tab commands share setup's run policy; without a renderer decision, create the tabs but don't run them.
        console.warn(`[hooks] default tab commands skipped for ${worktreePath}:`, error)
        defaultTabs = yamlHooks?.defaultTabs
          ? { tabs: yamlHooks.defaultTabs, runCommands: false }
          : undefined
      }
      const setupScript = hooks?.scripts.setup
      let shouldLaunchSetup = false
      if (setupScript) {
        try {
          shouldLaunchSetup = shouldRunSetupForCreate(repo, setupDecision)
        } catch (error) {
          // Why: worktree already exists; skip setup rather than fail a successful git create when the branch adds a hook without a renderer decision.
          console.warn(`[hooks] setup hook skipped for ${worktreePath}:`, error)
        }
      }
      if (setupScript && shouldLaunchSetup) {
        try {
          setup = await createRemoteSetupRunnerScript(
            repo,
            worktreePath,
            setupScript,
            ssh,
            fsProvider,
            yamlHooks?.setupAgentStartupPolicy
          )
        } catch (error) {
          console.error(`[hooks] Failed to prepare setup runner for ${worktreePath}:`, error)
        }
      }
    })
  }

  return { setup, defaultTabs, setupTrustMismatch }
}

export async function createRemoteSetupRunnerScript(
  repo: Repo,
  worktreePath: string,
  script: string,
  ssh: DirectSshWorktreeAuthority,
  fsProvider: IFilesystemProvider,
  projectStartupPolicy?: SetupAgentStartupPolicy
): Promise<CreateWorktreeResult['setup']> {
  const useWindowsFormat = isWindowsAbsolutePathLike(worktreePath)
  // Why: SSH terminals choose their shell on the remote host; local Windows
  // preferences cannot safely select a remote runner format or launch command.
  const runnerRelativePath = useWindowsFormat ? 'orca/setup-runner.cmd' : 'orca/setup-runner.sh'
  ssh.assertCurrent()
  const { stdout } = await ssh.provider.exec(
    ['rev-parse', '--git-path', runnerRelativePath],
    worktreePath
  )
  const path = useWindowsFormat ? win32 : posix
  const gitPath = stdout.trim()
  if (!gitPath || /[\r\n\0]/.test(gitPath)) {
    throw new Error('SSH Git returned an invalid setup runner path.')
  }
  const runnerScriptPath = path.resolve(worktreePath, gitPath)
  ssh.assertCurrent()
  if (getSshFilesystemProvider(ssh.connectionId) !== fsProvider) {
    throw new Error('SSH filesystem provider changed.')
  }
  await fsProvider.createDir(path.dirname(runnerScriptPath))
  ssh.assertCurrent()
  await fsProvider.writeFile(
    runnerScriptPath,
    useWindowsFormat ? buildWindowsRunnerScript(script) : buildPosixRunnerScript(script)
  )
  return {
    runnerScriptPath,
    envVars: getSetupRunnerEnvVars(repo, worktreePath),
    ...(shouldWaitForSetupBeforeAgentStartup(
      repo.hookSettings?.setupAgentStartupPolicy,
      projectStartupPolicy
    )
      ? { waitForAgentStartup: true }
      : {})
  }
}
