import { discoverSkills } from './discovery'
import { createSkillPackageArchive } from './skill-package-creation'
import type { SkillLibrarySource } from './skill-library-service'
import type { DiscoveredSkill, SkillDiscoveryResult } from '../../shared/skills'
import type { SkillLibraryCandidate } from '../../shared/skill-library-contract'
import { resolveEnvironmentSkillProviderRoots } from './skill-provider-runtime-roots'

export function skillLibraryCandidate(skill: DiscoveredSkill): SkillLibraryCandidate {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    sourceLabel: skill.sourceLabel,
    sourceKind: skill.sourceKind,
    providers: skill.providers
  }
}

export function skillLibraryCandidates(result: SkillDiscoveryResult): SkillLibraryCandidate[] {
  if (result.sources.some((source) => source.skippedReason === 'unavailable')) {
    throw new Error('Skill discovery is incomplete: a source is unavailable. Retry the host scan.')
  }
  return result.skills.map(skillLibraryCandidate)
}

export function nativeSkillLibrarySource(): SkillLibrarySource {
  const discover = () =>
    discoverSkills({
      repos: [],
      includeCwd: false,
      refresh: true,
      providerRootOverrides: resolveEnvironmentSkillProviderRoots()
    })
  return {
    hostId: 'local',
    discover: async () => skillLibraryCandidates(await discover()),
    package: async (candidateId, input) => {
      const discovered = await discover()
      skillLibraryCandidates(discovered)
      const skill = discovered.skills.find((row) => row.id === candidateId)
      if (!skill) {
        throw new Error('skill-library-candidate-not-found')
      }
      return createSkillPackageArchive({ ...input, sourceDirectory: skill.directoryPath })
    }
  }
}
