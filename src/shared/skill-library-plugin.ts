import { z } from 'zod'

export const SKILL_LIBRARY_PLUGIN_CAPABILITY = 'skills.library-plugin-groups.v1' as const
export const SkillLibraryPluginSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().min(1).max(200),
  source: z.string().min(1).max(1000),
  version: z.string().max(200).optional(),
  memberPath: z.string().min(1).max(500),
  totalSkills: z.number().int().positive().max(2000).optional()
})
export type SkillLibraryPlugin = z.infer<typeof SkillLibraryPluginSchema>

export function libraryVersionPlugins(version: {
  origins: readonly { plugin?: SkillLibraryPlugin }[]
}): SkillLibraryPlugin[] {
  const plugins = new Map<string, SkillLibraryPlugin>()
  for (const origin of version.origins) {
    if (origin.plugin) {
      plugins.set(origin.plugin.id, origin.plugin)
    }
  }
  return [...plugins.values()]
}

export function groupLibrarySkills<T>(
  rows: readonly T[],
  pluginsFor: (row: T) => readonly SkillLibraryPlugin[],
  separateVersions = false
): { id: string; plugin: SkillLibraryPlugin | null; rows: T[] }[] {
  const groups = new Map<string, { id: string; plugin: SkillLibraryPlugin | null; rows: T[] }>()
  for (const row of rows) {
    const plugin = pluginsFor(row)[0] ?? null
    const id = plugin
      ? `${plugin.id}${separateVersions ? `@${plugin.version ?? 'unknown'}` : ''}`
      : 'individual'
    let group = groups.get(id)
    if (!group) {
      group = { id, plugin, rows: [] }
      groups.set(id, group)
    }
    group.rows.push(row)
  }
  return [...groups.values()]
}

export function toggleLibrarySelection(
  selected: ReadonlySet<string>,
  keys: readonly string[],
  checked: boolean,
  limit = 50
): Set<string> {
  const next = new Set(selected)
  if (!checked) {
    for (const key of keys) {
      next.delete(key)
    }
    return next
  }
  const unique = [...new Set(keys)]
  // Never silently select half a plugin when the operation limit is reached.
  if (new Set([...next, ...unique]).size > limit) {
    return next
  }
  for (const key of unique) {
    next.add(key)
  }
  return next
}

export function preferredLibraryVersions<T extends { name: string; createdAt: string }>(
  rows: readonly T[]
): T[] {
  const names = new Map<string, T>()
  for (const row of rows) {
    const previous = names.get(row.name)
    if (!previous || row.createdAt > previous.createdAt) {
      names.set(row.name, row)
    }
  }
  return [...names.values()]
}
