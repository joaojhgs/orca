import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import {
  SkillLibraryAssignParams,
  SkillLibraryAssignmentSchema,
  type SkillLibrarySnapshot,
  type SkillLibraryVersion
} from '../../../../shared/skill-library-contract'
import type { SkillInstallDestination } from '../../../../shared/skill-install-contract'
import { skillLibraryDestinationKey } from '../../../../shared/skill-library-destination-key'

export type SkillAssignmentBatchResult = {
  versionId: string
  name: string
  status:
    | 'installed'
    | 'pending'
    | 'unavailable'
    | 'conflict'
    | 'failed'
    | 'unconfirmed'
    | 'not-started'
  message?: string
}
export type SkillAssignmentBatchProgress = { index: number; total: number; name: string }

export async function assignSkillBatch(input: {
  target: RuntimeClientTarget
  versions: readonly SkillLibraryVersion[]
  snapshot: SkillLibrarySnapshot
  destination: SkillInstallDestination
  providers: readonly string[]
  isCurrent(): boolean
  onProgress(progress: SkillAssignmentBatchProgress): void
}) {
  if (!input.versions.length || input.versions.length > 50) {
    throw new Error('Select between one and 50 imported skills.')
  }
  if (new Set(input.versions.map((version) => version.name)).size !== input.versions.length) {
    throw new Error('Select only one version of each skill.')
  }
  if (!input.providers.length) {
    throw new Error('Select at least one agent runtime.')
  }
  const destination = input.destination
  const hostId =
    destination.scope === 'workspace'
      ? input.snapshot.workspaces.find((workspace) =>
          destination.worktreeId
            ? workspace.kind === 'worktree' && workspace.id === destination.worktreeId
            : workspace.kind === 'folder' && workspace.id === destination.folderWorkspaceId
        )?.hostId
      : destination.executionTarget?.kind === 'ssh'
        ? `ssh:${destination.executionTarget.connectionId}`
        : destination.executionTarget?.kind === 'wsl'
          ? `wsl:${destination.executionTarget.distro}`
          : 'local'
  if (!hostId || !input.snapshot.hosts.some((host) => host.id === hostId)) {
    throw new Error('Refresh the library before assigning to an unknown destination.')
  }
  const destinationKey = skillLibraryDestinationKey(input.destination)
  const requests = input.versions.map((version) => {
    if (!input.snapshot.versions.some((row) => row.versionId === version.versionId)) {
      throw new Error('Refresh the imported library before assigning missing versions.')
    }
    const existing = input.snapshot.assignments.find(
      (row) =>
        row.packageId === version.packageId &&
        skillLibraryDestinationKey(row.destination) === destinationKey &&
        row.status !== 'removed'
    )
    return SkillLibraryAssignParams.parse({
      versionId: version.versionId,
      destination: input.destination,
      providers: [...new Set([...input.providers, ...(existing?.providers ?? [])])]
    })
  })
  const results: SkillAssignmentBatchResult[] = []
  let stop = false
  for (const [index, version] of input.versions.entries()) {
    if (stop || !input.isCurrent()) {
      results.push({ versionId: version.versionId, name: version.name, status: 'not-started' })
      continue
    }
    input.onProgress({ index: index + 1, total: input.versions.length, name: version.name })
    try {
      // Existing RPC keeps mixed-version servers compatible and bounds host/controller RAM.
      const response = await callRuntimeRpc(
        input.target,
        'skills.library.assign',
        requests[index],
        {
          timeoutMs: 600000
        }
      )
      const parsed = SkillLibraryAssignmentSchema.safeParse(response)
      if (
        !parsed.success ||
        parsed.data.versionId !== version.versionId ||
        parsed.data.packageId !== version.packageId ||
        parsed.data.executionHostId !== hostId ||
        requests[index].providers.some((provider) => !parsed.data.providers.includes(provider)) ||
        skillLibraryDestinationKey(parsed.data.destination) !== destinationKey ||
        parsed.data.desiredState !== 'installed' ||
        parsed.data.status === 'removed'
      ) {
        stop = true
        results.push({
          versionId: version.versionId,
          name: version.name,
          status: 'unconfirmed',
          message: 'Unexpected assignment response. Refresh Assignments before retrying.'
        })
        continue
      }
      results.push({
        versionId: version.versionId,
        name: version.name,
        status: parsed.data.status,
        message: parsed.data.message ?? undefined
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Assignment request failed'
      const unconfirmed = /timed out|disconnect|closed|connection|network/i.test(message)
      stop = unconfirmed
      results.push({
        versionId: version.versionId,
        name: version.name,
        status: unconfirmed ? 'unconfirmed' : 'failed',
        message: unconfirmed
          ? `${message}. Refresh Assignments before retrying; the server may still be working.`
          : message
      })
    }
  }
  return results
}
