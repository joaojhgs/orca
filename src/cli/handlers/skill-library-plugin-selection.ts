import type { SkillLibraryVersion } from '../../shared/skill-library-contract'
import { libraryVersionPlugins, preferredLibraryVersions } from '../../shared/skill-library-plugin'
import { RuntimeClientError } from '../runtime/types'

export function selectImportedPluginVersions(
  versions: readonly SkillLibraryVersion[],
  selector: string,
  excluded: readonly string[]
) {
  const matches = versions.filter((row) =>
    libraryVersionPlugins(row).some((plugin) => plugin.id === selector || plugin.name === selector)
  )
  const ids = new Set(
    matches.flatMap((row) =>
      libraryVersionPlugins(row)
        .filter((plugin) => plugin.id === selector || plugin.name === selector)
        .map((plugin) => plugin.id)
    )
  )
  if (ids.size !== 1) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Plugin is missing or ambiguous. Use its exact ID.'
    )
  }
  const selected = preferredLibraryVersions(matches).filter(
    (row) => !excluded.includes(row.name) && !excluded.includes(row.versionId)
  )
  if (!selected.length || selected.length > 50) {
    throw new RuntimeClientError('invalid_argument', 'Select between one and 50 plugin skills.')
  }
  return selected
}
