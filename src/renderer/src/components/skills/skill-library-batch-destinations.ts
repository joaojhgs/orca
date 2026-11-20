import { assignSkillBatch, type SkillAssignmentBatchResult } from './skill-library-batch-assign'

export async function assignSkillDestinations(
  input: Omit<Parameters<typeof assignSkillBatch>[0], 'destination'> & {
    destinations: readonly Parameters<typeof assignSkillBatch>[0]['destination'][]
  }
) {
  const results: SkillAssignmentBatchResult[] = []
  let stopped = false
  for (const destination of input.destinations) {
    const workspace =
      destination.scope === 'workspace'
        ? input.snapshot.workspaces.find(
            (row) => row.id === (destination.worktreeId ?? destination.folderWorkspaceId)
          )
        : null
    const destinationLabel = workspace ? `${workspace.hostId} · ${workspace.label}` : undefined
    if (stopped || !input.isCurrent()) {
      results.push(
        ...input.versions.map((version) => ({
          versionId: version.versionId,
          name: version.name,
          status: 'not-started' as const,
          destinationLabel
        }))
      )
      continue
    }
    const batch = await assignSkillBatch({ ...input, destination })
    results.push(...batch.map((row) => ({ ...row, destinationLabel })))
    stopped = batch.some((row) => row.status === 'unconfirmed')
  }
  return results
}
