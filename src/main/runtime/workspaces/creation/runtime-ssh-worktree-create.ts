import type { WorktreeLineageInput } from '../lineage/runtime-worktree-lineage-resolution'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { RuntimeManagedWorktreeCreateArgs } from './runtime-managed-worktree-create-types'
import type { CreateWorktreeResult } from '../../../../shared/worktree/create-types'
import { captureDirectSshWorktreeAuthority } from '../../../ipc/worktrees/direct-ssh-worktree-authority'
import { createRemoteWorktree } from '../../../ipc/worktrees/create/create-direct-ssh-worktree'
import { Store } from '../../../persistence/loading-store/store'
import { startRuntimeLocalWorktreeTerminals } from '../startup/runtime-local-worktree-terminal-startup'
import type { resolveManagedWorktreeCreateStartup } from '../startup/managed-worktree-create-startup'
import { createdWorktreeLifecycleIdentity } from '../lifecycle/worktree-lifecycle-event'
import type { RuntimeStore } from '../../construction/runtime-store-contract'
import type { Worktree } from '../../../../shared/worktree/types'
import type { WorktreeCreateTimingRecorder } from '../../../workspaces/creation/worktree-create-timing'
import type { RuntimeLocalWorktreeTerminalPorts } from '../startup/runtime-local-worktree-terminal-startup'
import type { RuntimeWorktreeLifecycleEvent } from '../lifecycle/worktree-lifecycle-event'
import type { recordCreatedWorktreeLineage } from '../lineage/runtime-worktree-lineage-recording'

export async function createRuntimeSshManagedWorktree({
  args,
  repo,
  store,
  connectionId,
  timing,
  startup,
  lineageInput,
  onWorkspaceCreated,
  readStoreInstallationId,
  recordWorktreeCreated,
  terminalPorts,
  emitCreated
}: {
  args: RuntimeManagedWorktreeCreateArgs
  repo: Repo
  store: RuntimeStore
  connectionId: string
  timing: WorktreeCreateTimingRecorder
  startup: Awaited<ReturnType<typeof resolveManagedWorktreeCreateStartup>>
  lineageInput: WorktreeLineageInput | undefined
  onWorkspaceCreated: (worktreeId: string) => void
  readStoreInstallationId: () => Promise<string | undefined>
  recordWorktreeCreated: (worktree: Worktree) => ReturnType<typeof recordCreatedWorktreeLineage>
  terminalPorts: (worktree: Worktree) => RuntimeLocalWorktreeTerminalPorts
  emitCreated: (event: RuntimeWorktreeLifecycleEvent) => void
}): Promise<CreateWorktreeResult> {
  const {
    effectiveStartup,
    effectiveStartupFollowup,
    startupLaunchRuntime,
    effectiveCreatedWithAgent,
    effectiveDraftPaste
  } = startup
  // Preserve the execution host label if the SSH transport is currently unavailable.
  timing.recordExecutionHost('ssh')
  if (!(store instanceof Store)) {
    throw new Error('runtime_unavailable')
  }
  const ssh = captureDirectSshWorktreeAuthority(connectionId)
  const result = await createRemoteWorktree(
    {
      ...args,
      repoId: repo.id,
      createdWithAgent: effectiveCreatedWithAgent,
      linkedIssue: args.linkedIssue ?? undefined,
      linkedPR: args.linkedPR ?? undefined,
      linkedGitLabMR: args.linkedGitLabMR ?? undefined,
      linkedGitLabIssue: args.linkedGitLabIssue ?? undefined,
      linkedBitbucketPR: args.linkedBitbucketPR ?? undefined,
      linkedAzureDevOpsPR: args.linkedAzureDevOpsPR ?? undefined,
      linkedGiteaPR: args.linkedGiteaPR ?? undefined
    },
    repo,
    store,
    undefined,
    ssh,
    { readStoreInstallationId },
    timing,
    onWorkspaceCreated
  )
  const worktree = result.worktree
  const recorded = recordWorktreeCreated(worktree)

  const terminal = await startRuntimeLocalWorktreeTerminals({
    request: args,
    repo,
    worktree,
    setup: result.setup,
    defaultTabs: result.defaultTabs,
    startup: effectiveStartup,
    startupFollowup: effectiveStartupFollowup,
    startupLaunchRuntime,
    createdWithAgent: effectiveCreatedWithAgent,
    promisedAgentChat: args.promisedAgentChat,
    draftPaste: effectiveDraftPaste,
    warning: result.warning,
    ports: terminalPorts(worktree)
  })
  emitCreated({
    kind: 'created',
    worktreeId: worktree.id,
    path: worktree.path,
    branch: worktree.branch,
    ...createdWorktreeLifecycleIdentity(worktree)
  })
  const { setup: _setup, ...created } = result
  return {
    ...created,
    ...(lineageInput ? recorded : {}),
    worktree: {
      ...worktree,
      parentWorktreeId: recorded.lineage?.parentWorktreeId ?? null,
      childWorktreeIds: worktree.childWorktreeIds ?? [],
      lineage: recorded.lineage,
      workspaceLineage: recorded.workspaceLineage
    },
    ...(terminal.returnedSetup ? { setup: terminal.returnedSetup } : {}),
    ...(terminal.warning ? { warning: terminal.warning } : {}),
    ...(terminal.didSpawnStartup && terminal.startupTerminalHandle
      ? {
          startupTerminal: {
            spawned: true,
            handle: terminal.startupTerminalHandle,
            ...(terminal.startupTerminalTabId ? { tabId: terminal.startupTerminalTabId } : {}),
            ...(terminal.startupTerminalPaneKey
              ? { paneKey: terminal.startupTerminalPaneKey }
              : {}),
            ...(terminal.startupTerminalPtyId ? { ptyId: terminal.startupTerminalPtyId } : {}),
            surface: 'background' as const
          }
        }
      : {})
  }
}
