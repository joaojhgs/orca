import { discoverSkills } from './discovery'
import { createSkillPackageArchive } from './skill-package-creation'
import type { SkillLibrarySource } from './skill-library-service'
import type { DiscoveredSkill, SkillDiscoveryResult } from '../../shared/skills'
import type { SkillLibraryCandidate } from '../../shared/skill-library-contract'
import { resolveEnvironmentSkillProviderRoots } from './skill-provider-runtime-roots'
import { relative, sep } from 'node:path'
import { discoverLibraryPluginRoots } from './skill-library-plugin-discovery'

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

export function nativeSkillLibrarySource(options: { homeDir?: string } = {}): SkillLibrarySource {
  const discover = async () => {
    const plugins = await discoverLibraryPluginRoots(options.homeDir)
    const result = await discoverSkills({
      repos: [],
      homeDir: options.homeDir,
      includeCwd: false,
      refresh: true,
      providerRootOverrides: options.homeDir ? {} : resolveEnvironmentSkillProviderRoots(),
      extraRoots: plugins.map((row) => row.root)
    })
    const candidates = skillLibraryCandidates(result).map((candidate, index) => {
      const skill = result.skills[index]
      const owner = plugins.find(({ root }) =>
        (skill.rootPaths ?? [skill.rootPath]).includes(root.path)
      )
      if (!owner) {
        return candidate
      }
      return {
        ...candidate,
        plugin: {
          ...owner.plugin,
          memberPath: [
            'skills',
            relative(owner.root.path, skill.directoryPath).split(sep).join('/')
          ].join('/')
        }
      }
    })
    return { result, candidates }
  }
  return {
    hostId: 'local',
    discover: async () => (await discover()).candidates,
    package: async (candidateId, input) => {
      const discovered = await discover()
      const skill = discovered.result.skills.find((row) => row.id === candidateId)
      if (!skill) {
        throw new Error('skill-library-candidate-not-found')
      }
      return createSkillPackageArchive({ ...input, sourceDirectory: skill.directoryPath })
    }
  }
}
