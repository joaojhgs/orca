import { randomUUID } from 'node:crypto'
import type { SkillLibraryPlacement } from './skill-library-assignments'
import type { ResolvedSkillInstallDestination } from './skill-install-destinations'
import { installSharedSkill, removeSharedSkill } from './skill-install-service'
import type { SkillProviderRootOverrides } from './skill-provider-destinations'

export function nativeSkillLibraryPlacement(input: {
  destination: ResolvedSkillInstallDestination
  orcaStateDirectory: string
  hostIdentity: string
  providerRootOverrides?: SkillProviderRootOverrides
}): SkillLibraryPlacement {
  if (input.destination.wslDistro) {
    throw new Error('skill-library-wsl-not-supported')
  }
  return {
    install: (version, archivePath, assignment) =>
      installSharedSkill({
        ...input.destination,
        ...input,
        operationId: randomUUID(),
        archivePath,
        detectedProviders: assignment.providers,
        conflictResolution: 'replace-unmodified',
        requirePackageOwnership: true,
        expectedPackageId: version.packageId,
        expectedVersionId: version.versionId,
        expectedPackageDigest: version.packageDigest,
        expectedArchiveSha256: version.archiveSha256
      }),
    remove: (version, assignment) =>
      removeSharedSkill({
        ...input.destination,
        ...input,
        operationId: randomUUID(),
        skillName: version.name,
        expectedPackageId: version.packageId,
        detectedProviders: assignment.providers
      })
  }
}
