import type { SkillInstallDestination } from './skill-install-contract'

export function skillLibraryDestinationKey(destination: SkillInstallDestination): string {
  if (destination.scope === 'workspace') {
    return JSON.stringify([
      'workspace',
      destination.worktreeId ?? null,
      destination.folderWorkspaceId ?? null
    ])
  }
  const target = destination.executionTarget
  return JSON.stringify([
    'global',
    destination.environmentId ?? null,
    target?.kind ?? 'host',
    target?.kind === 'ssh' ? target.connectionId : target?.kind === 'wsl' ? target.distro : null
  ])
}
