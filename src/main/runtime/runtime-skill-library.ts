import { join } from 'node:path'
import { ensureActiveOrcaProfile } from '../orca-profiles/profile-index-store'
import { SkillLibraryService } from '../skills/skill-library-service'
import {
  SkillLibraryAssignments,
  SkillLibraryUnavailableError
} from '../skills/skill-library-assignments'
import { nativeSkillLibrarySource } from '../skills/skill-library-source'
import { nativeSkillLibraryPlacement } from '../skills/skill-library-placement'
import { sshSkillLibrarySource } from '../skills/skill-library-ssh-source'
import { sshSkillLibraryPlacement } from '../skills/skill-library-ssh-placement'
import {
  getSshConnectionManager,
  getRegisteredSshState,
  listRegisteredSshTargets
} from '../ssh/targets/ssh-target-registry'
import { onSshFilesystemProviderRegistered } from '../providers/ssh-filesystem-dispatch'
import {
  getRepoExecutionHostId,
  parseExecutionHostId,
  toSshExecutionHostId
} from '../../shared/execution-host/execution-host'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import { resolveSkillInstallDestination } from '../skills/install/skill-install-destinations'
import type { SkillInstallDestination } from '../../shared/skills/installation/skill-install-contract'
import { SKILL_INSTALL_PROVIDERS } from '../../shared/skills/installation/skill-install-providers'
import {
  createSkillInstallAuthority,
  folderExecutionHostId,
  resolveSkillProviderRoots,
  resolveSkillSshDestination
} from './integrations/skill/runtime-skill-install-authority'
import type { RuntimeSkillCommandHost } from './integrations/skill/runtime-skill-command-contract'

type LibraryContext = {
  root: string
  library: SkillLibraryService
  assignments: SkillLibraryAssignments
  dispose(): Promise<void>
}
const contexts = new WeakMap<RuntimeSkillCommandHost, LibraryContext>()

function requireConnection(id: string) {
  if (!listRegisteredSshTargets().some((row) => row.id === id)) {
    throw new Error('skill-library-host-not-registered')
  }
  const connection = getSshConnectionManager()?.getConnection(id)
  if (!connection || connection.getState().status !== 'connected') {
    throw new SkillLibraryUnavailableError('skill-library-host-unavailable')
  }
  return connection
}

export function skillLibraryHosts() {
  return [
    { id: 'local', label: 'Orca server', reachable: true },
    ...listRegisteredSshTargets().map((target) => ({
      id: toSshExecutionHostId(target.id),
      label: target.label,
      reachable: getRegisteredSshState(target.id)?.status === 'connected'
    }))
  ]
}

export async function skillLibraryWorkspaces(host: RuntimeSkillCommandHost) {
  const repos = host.listRepos()
  const worktrees = (await host.listResolvedWorktrees()).flatMap((row) => {
    const repo = repos.find((candidate) => candidate.id === getRepoIdFromWorktreeId(row.id))
    const hostId = row.hostId ?? (repo ? getRepoExecutionHostId(repo) : null)
    // Why: an unknown owner must never become a local provisioning destination.
    return hostId ? [{ id: row.id, kind: 'worktree' as const, label: row.path, hostId }] : []
  })
  const folders = host.listFolderWorkspaces().map((row) => ({
    id: row.id,
    kind: 'folder' as const,
    label: row.folderPath,
    hostId: folderExecutionHostId(row)
  }))
  return [...worktrees, ...folders]
    .filter((row) => row.hostId === 'local' || row.hostId.startsWith('ssh:'))
    .slice(0, 8192)
}

export function skillLibrarySource(hostId: string) {
  const host = parseExecutionHostId(hostId)
  if (!host) {
    throw new Error('skill-library-host-invalid')
  }
  if (host.kind === 'local') {
    return nativeSkillLibrarySource()
  }
  if (host.kind !== 'ssh') {
    throw new Error('skill-library-host-not-supported')
  }
  return sshSkillLibrarySource(requireConnection(host.targetId))
}

async function validateDestination(
  host: RuntimeSkillCommandHost,
  environmentId: string,
  destination: SkillInstallDestination
) {
  if (
    destination.scope === 'global' &&
    destination.environmentId &&
    ![host.getRuntimeId(), environmentId].includes(destination.environmentId)
  ) {
    throw new Error('skill-library-environment-mismatch')
  }
  const normalized =
    destination.scope === 'global'
      ? {
          ...destination,
          environmentId,
          executionTarget: destination.executionTarget ?? { kind: 'host' as const }
        }
      : destination
  const remote = await resolveSkillSshDestination(host, destination)
  if (remote) {
    if (!listRegisteredSshTargets().some((row) => row.id === remote.connectionId)) {
      throw new Error('skill-library-host-not-registered')
    }
  } else {
    const resolved = await resolveSkillInstallDestination(normalized, {
      ...createSkillInstallAuthority(host),
      environmentId
    })
    if (resolved.wslDistro) {
      throw new Error('skill-library-wsl-not-supported')
    }
  }
  return normalized
}

export function getRuntimeSkillLibrary(host: RuntimeSkillCommandHost): LibraryContext {
  const profile = ensureActiveOrcaProfile(host.getUserDataPath())
  const root = join(host.getUserDataPath(), 'skill-library', profile.profile.id)
  const environmentId = `skill-library:${profile.profile.id}`
  const existing = contexts.get(host)
  if (existing?.root === root) {
    return existing
  }
  const previousDisposal = existing?.dispose()
  const library = new SkillLibraryService(root)
  const assignments = new SkillLibraryAssignments(library, {
    validate: (destination) => validateDestination(host, environmentId, destination),
    executionHostId: async (destination) => {
      const target = await resolveSkillSshDestination(host, destination)
      return target ? toSshExecutionHostId(target.connectionId) : 'local'
    },
    resolve: async (destination, executionHostId) => {
      await host.skillTransactionRecovery
      await validateDestination(host, environmentId, destination)
      const remote = await resolveSkillSshDestination(host, destination)
      if ((remote ? toSshExecutionHostId(remote.connectionId) : 'local') !== executionHostId) {
        throw new Error('skill-library-workspace-host-changed')
      }
      if (remote) {
        return sshSkillLibraryPlacement(requireConnection(remote.connectionId), {
          scope: destination.scope,
          ...(remote.workspace ? { workspaceDirectory: remote.workspace.path } : {}),
          destinationIdentity:
            destination.scope === 'global'
              ? `global:${environmentId}:ssh:${remote.connectionId}`
              : `workspace:${environmentId}:${remote.workspace!.id}`,
          hostIdentity: toSshExecutionHostId(remote.connectionId)
        })
      }
      const resolved = await resolveSkillInstallDestination(destination, {
        ...createSkillInstallAuthority(host),
        environmentId
      })
      return nativeSkillLibraryPlacement({
        destination: resolved,
        orcaStateDirectory: host.getUserDataPath(),
        hostIdentity: 'local',
        providerRootOverrides: await resolveSkillProviderRoots(host, resolved)
      })
    }
  })
  let disposed = false
  let retryInFlight: Promise<void> | undefined
  let awaitingRecovery = false
  let retryRequested = false
  const retry = async () => {
    retryRequested = true
    if (disposed || awaitingRecovery || retryInFlight) {
      return
    }
    // Disposal only joins reconciliation that has passed startup recovery.
    awaitingRecovery = true
    try {
      await host.skillTransactionRecovery
    } finally {
      awaitingRecovery = false
    }
    if (disposed) {
      return
    }
    retryInFlight = Promise.resolve().then(async () => {
      try {
        while (retryRequested && !disposed) {
          retryRequested = false
          const catalog = await library.store.snapshot()
          for (const row of catalog.assignments) {
            if (disposed) {
              return
            }
            if (['pending', 'unavailable'].includes(row.status)) {
              await assignments.reconcile(row.id)
            }
          }
        }
      } finally {
        retryInFlight = undefined
      }
    })
    await retryInFlight
  }
  const unsubscribe = onSshFilesystemProviderRegistered(() => {
    if (!disposed) {
      void retry().catch(() =>
        console.warn('[skills] Library retry failed; refresh the library to inspect its state.')
      )
    }
  })
  const context = {
    root,
    library,
    assignments,
    dispose: async () => {
      disposed = true
      unsubscribe()
      // Retry failures are reported by the startup and SSH registration callers.
      await Promise.allSettled([previousDisposal, retryInFlight])
    }
  }
  contexts.set(host, context)
  void retry().catch(() =>
    console.warn('[skills] Library recovery failed; refresh the library to inspect its state.')
  )
  return context
}

export async function disposeRuntimeSkillLibrary(host: RuntimeSkillCommandHost): Promise<void> {
  const context = contexts.get(host)
  contexts.delete(host)
  await context?.dispose()
}

export const skillLibraryProviders = () =>
  SKILL_INSTALL_PROVIDERS.map(({ id, displayName }) => ({ id, displayName }))
