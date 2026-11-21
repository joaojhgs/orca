import { join } from 'node:path'
import type {
  SkillInstallResult,
  SkillRemoveRequest
} from '../../../shared/skills/installation/skill-install-contract'
import { SKILL_INSTALL_PROVIDERS } from '../../../shared/skills/installation/skill-install-providers'
import {
  resolveSkillInstallDestination,
  type ResolvedSkillInstallDestination
} from '../install/skill-install-destinations'
import type { ManagementDependencies } from '../install/skill-install-preview'
import { canonicalPath } from '../install/skill-install-paths'
import {
  resolveSkillProviderDestinations,
  type SkillProviderRootOverrides
} from '../providers/skill-provider-destinations'
import { createWslSkillInstallFilesystem } from '../filesystem/skill-wsl-install-filesystem'
import { removeLocalSharedSkill } from './skill-remove-transaction'

export async function removeSharedSkillInstall(
  request: SkillRemoveRequest,
  dependencies: ManagementDependencies
): Promise<SkillInstallResult> {
  const destination = await resolveSkillInstallDestination(
    request.destination,
    dependencies.authority
  )
  const providerRootOverrides = await dependencies.resolveProviderRootOverrides?.(destination)
  return removeSharedSkill({
    ...destination,
    operationId: request.operationId,
    skillName: request.name,
    orcaStateDirectory: dependencies.stateDirectory,
    detectedProviders: SKILL_INSTALL_PROVIDERS.map((provider) => provider.id),
    providerRootOverrides,
    conflictResolution: request.conflictResolution
  })
}

export function removeSharedSkill(
  input: ResolvedSkillInstallDestination & {
    operationId: string
    skillName: string
    orcaStateDirectory: string
    detectedProviders: readonly string[]
    providerRootOverrides?: SkillProviderRootOverrides
    conflictResolution?: SkillRemoveRequest['conflictResolution']
    expectedPackageId?: string
  }
): Promise<SkillInstallResult> {
  const filesystem = input.wslDistro
    ? createWslSkillInstallFilesystem({
        distro: input.wslDistro,
        homeDirectory: input.homeDirectory,
        workspaceDirectory: input.workspaceDirectory,
        providerRootOverrides: input.providerRootOverrides
      })
    : undefined
  const providerRoots = resolveSkillProviderDestinations(input).map((provider) => provider.rootPath)
  return removeLocalSharedSkill({
    operationId: input.operationId,
    canonicalPath: canonicalPath(input, input.skillName),
    stateDirectory: join(input.orcaStateDirectory, 'skill-installs'),
    allowedProviderRoots: providerRoots,
    conflictResolution: input.conflictResolution,
    expectedPackageId: input.expectedPackageId,
    filesystem
  })
}
