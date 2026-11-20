import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  SkillLibraryPluginSchema,
  type SkillLibraryPlugin
} from '../../shared/skill-library-plugin'
import { stripUnsafeDisplayCharacters } from '../../shared/skill-display-text'

const ManifestSchema = z.object({
  name: z.string().min(1).max(200),
  version: z.string().max(200).optional(),
  repository: z.union([z.string(), z.object({ url: z.string() })]).optional()
})

export function skillLibraryPluginOrigin(
  value: unknown,
  fallbackSource: string,
  memberPath: string
): SkillLibraryPlugin | null {
  const parsed = ManifestSchema.safeParse(value)
  if (!parsed.success) {
    return null
  }
  const manifest = parsed.data
  const repository =
    typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
  const github = repository?.match(/(?:github\.com[/:])([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i)
  const source = fallbackSource.startsWith('https://github.com/')
    ? fallbackSource
    : github
      ? `https://github.com/${github[1].toLowerCase()}`
      : fallbackSource
  const name = stripUnsafeDisplayCharacters(manifest.name)
  return SkillLibraryPluginSchema.parse({
    id: createHash('sha256').update(`${source}#${name}`).digest('hex'),
    name,
    source,
    version: manifest.version,
    memberPath: memberPath.replaceAll('\\', '/')
  })
}
