import { projectGroupIdFromRepoId } from '../../../../shared/folder-workspaces/folder-workspace-worktree'
import { projectGroupHookOwner } from '../../../../shared/workspace-setup/hooks/workspace-hook-owner'
import { isFolderRepo } from '../../../../shared/repository/repo-kind'
import {
  getRepoExecutionHostId,
  isRepoOnCatalogHost
} from '../../../../shared/execution-host/execution-host'
import { scopeHooksToRepoKind } from '../../../../shared/folder-workspaces/folder-workspace-hooks'
import { getSetupRunnerCommandPlatformForPath } from '../../../../shared/agent-launch/startup/setup-runner-command'
import type { RunApprovedWorktreeSetupResult } from '../../../../shared/worktree/create-types'
import {
  getDefaultTabsLaunch,
  getEffectiveHooksFromConfig
} from '../../../workspace-hooks/effective-hook-config'
import { captureDirectSshWorktreeAuthority } from '../../../ipc/worktrees/direct-ssh-worktree-authority'
import { createRemoteSetupRunnerScript } from '../../../ipc/worktrees/create/create-direct-ssh-worktree'
import { readDirectSshOrcaYaml } from '../../../ipc/worktrees/removal/direct-ssh-archive-hooks'
import { getSshFilesystemProvider } from '../../../providers/ssh-filesystem-dispatch'
import { resolveWorktreeCreateRoute } from '../../../workspaces/creation/worktree-create-execution-host-route'
import { loadHooks } from '../../../workspace-hooks/hooks'
import {
  checkCreatedWorktreeSetupTrust,
  defaultTabsWithCommands
} from '../../../workspace-hooks/created-worktree-setup-trust'
import {
  createSetupRunnerScript,
  resolveSetupRunnerShell
} from '../../../workspace-hooks/worktree-runner-script'
import { getLocalProjectWorktreeGitOptions } from '../../../workspaces/execution-host/project-runtime-git-options'
import type { Worktree } from '../../../../shared/worktree/types'
import type { RuntimeStore } from '../../construction/runtime-store-contract'
import type { WorktreeTerminalProvisioningArgs } from '../startup/runtime-worktree-terminal-provisioning'

type ApprovedSetupRuntime = {
  showManagedWorktree: (
    selector: string,
    requiredHostId?: undefined,
    options?: { matchFolders?: boolean }
  ) => Promise<Pick<Worktree, 'id' | 'repoId' | 'path' | 'displayName' | 'hostId'>>
  requireStore: () => Pick<
    RuntimeStore,
    'getRepo' | 'getRepoForHost' | 'getSettings' | 'getProjectGroups'
  >
  provisionManagedWorktreeTerminals: (
    args: WorktreeTerminalProvisioningArgs
  ) => Promise<{ failed?: true }>
}

/**
 * Start setup and default-tab commands a create skipped, once the user approved this worktree's
 * own content. Re-hashes first, so only the approved bytes run.
 */
export async function runApprovedCreatedWorktreeSetup(
  runtime: ApprovedSetupRuntime,
  worktreeSelector: string,
  approvedSetupHash: string,
  options: { wslUserAct?: true } = {}
): Promise<RunApprovedWorktreeSetupResult> {
  const worktree = await runtime.showManagedWorktree(worktreeSelector, undefined, {
    matchFolders: true
  })
  const store = runtime.requireStore()
  const groupId = projectGroupIdFromRepoId(worktree.repoId)
  const group = groupId
    ? store.getProjectGroups?.().find((entry) => entry.id === groupId)
    : undefined
  const storedRepo = groupId
    ? undefined
    : worktree.hostId && store.getRepoForHost
      ? store.getRepoForHost(worktree.repoId, worktree.hostId)
      : store.getRepo(worktree.repoId)
  const repo = group ? projectGroupHookOwner(group) : storedRepo
  const hooksRoot = group ? group.parentPath : worktree.path
  if (!repo || !hooksRoot || (isFolderRepo(repo) && !isRepoOnCatalogHost(repo))) {
    return { status: 'not_configured' }
  }
  if (storedRepo && worktree.hostId && getRepoExecutionHostId(storedRepo) !== worktree.hostId) {
    return { status: 'not_configured' }
  }
  const route = storedRepo ? resolveWorktreeCreateRoute(storedRepo) : undefined
  if (route?.kind === 'runtime' || (route?.kind === 'local' && !isRepoOnCatalogHost(repo))) {
    return { status: 'not_configured' }
  }
  const ssh = route?.kind === 'ssh' ? captureDirectSshWorktreeAuthority(route.connectionId) : null
  const fsProvider = ssh ? getSshFilesystemProvider(ssh.connectionId) : undefined
  if (ssh) {
    if (!fsProvider) {
      throw new Error('SSH filesystem is unavailable. Reconnect before starting workspace setup.')
    }
    await ssh.registerRoot(hooksRoot)
  }
  const yamlHooks = scopeHooksToRepoKind(
    repo,
    ssh ? await readDirectSshOrcaYaml(fsProvider, hooksRoot) : loadHooks(hooksRoot)
  )
  ssh?.assertCurrent()
  const mismatch = checkCreatedWorktreeSetupTrust(repo, yamlHooks, 'run', { approvedSetupHash })
  if (mismatch) {
    return { status: 'mismatch', setupTrustMismatch: mismatch }
  }
  const setupScript = getEffectiveHooksFromConfig(repo, yamlHooks)?.scripts.setup
  const setup = setupScript
    ? ssh && fsProvider && storedRepo
      ? await createRemoteSetupRunnerScript(
          storedRepo,
          hooksRoot,
          setupScript,
          ssh,
          fsProvider,
          yamlHooks?.setupAgentStartupPolicy
        )
      : await createSetupRunnerScript(
          repo,
          hooksRoot,
          setupScript,
          storedRepo ? getLocalProjectWorktreeGitOptions(store, storedRepo) : undefined,
          resolveSetupRunnerShell(store.getSettings()),
          yamlHooks?.setupAgentStartupPolicy,
          {
            worktreeId: worktree.id,
            displayName: worktree.displayName,
            workspacePath: worktree.path
          }
        )
    : undefined
  ssh?.assertCurrent()
  // The create already opened the command-less default tabs.
  const defaultTabs = defaultTabsWithCommands(getDefaultTabsLaunch(yamlHooks, repo, 'run'))
  if (!setup && !defaultTabs) {
    return { status: 'not_configured' }
  }
  const provisioned = await runtime.provisionManagedWorktreeTerminals({
    worktreeSelector: `id:${worktree.id}`,
    worktreeId: worktree.id,
    worktreePath: worktree.path,
    ...(setup ? { setup: { ...setup, ...(group ? { cwd: hooksRoot } : {}) } } : {}),
    ...(defaultTabs ? { defaultTabs, defaultTabsBesideExisting: true as const } : {}),
    hasStartupTerminal: true,
    setupCommandPlatform: getSetupRunnerCommandPlatformForPath(
      setup?.runnerScriptPath ?? '',
      !ssh && process.platform === 'win32' ? 'windows' : 'posix'
    ),
    ...options
  })
  if (provisioned.failed) {
    // An error reaches every client's existing failure handling; a new status would be ignored by older ones.
    throw new Error('Could not start the approved setup commands in this workspace.')
  }
  return { status: 'started' }
}
