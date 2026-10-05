import type { SkillInstallDestination } from '../../../../shared/skill-install-contract'
import { skillLibraryDestinationKey } from '../../../../shared/skill-library-destination-key'

export function matchesSkillAssignmentDestination(
  requested: SkillInstallDestination,
  saved: SkillInstallDestination
): boolean {
  if (requested.scope === 'global' && saved.scope === 'global' && !requested.environmentId) {
    // The runtime pins its own library profile; it is not a different execution destination.
    if (saved.environmentId && !/^skill-library:.+/.test(saved.environmentId)) {
      return false
    }
    const { environmentId: _profile, ...withoutProfile } = saved
    return skillLibraryDestinationKey(requested) === skillLibraryDestinationKey(withoutProfile)
  }
  return skillLibraryDestinationKey(requested) === skillLibraryDestinationKey(saved)
}
