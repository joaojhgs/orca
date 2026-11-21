import { lstat, opendir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SkillScanRoot } from './discovery/skill-discovery-sources'
import { skillLibraryPluginOrigin } from './skill-library-plugin-origin'
import type { SkillLibraryPlugin } from '../../shared/skill-library-plugin'
import { resolveEnvironmentSkillProviderRoots } from './providers/skill-provider-runtime-roots'
import { dirname } from 'node:path'

export type LibraryPluginRoot = { root: SkillScanRoot; plugin: SkillLibraryPlugin }

export async function discoverLibraryPluginRoots(home = homedir()): Promise<LibraryPluginRoot[]> {
  const found: LibraryPluginRoot[] = []
  const claudeRoot =
    home === homedir()
      ? dirname(resolveEnvironmentSkillProviderRoots().claude ?? join(home, '.claude', 'skills'))
      : join(home, '.claude')
  const pending = [
    {
      path: join(home, '.codex', 'plugins', 'cache'),
      depth: 0,
      provider: 'codex' as const,
      owner: 'codex' as const
    },
    {
      path: join(claudeRoot, 'plugins', 'cache'),
      depth: 0,
      provider: 'claude' as const,
      owner: 'claude' as const
    },
    {
      path: join(home, '.cursor', 'plugins', 'cache'),
      depth: 0,
      provider: 'agent-skills' as const,
      owner: 'cursor' as const
    }
  ]
  let visited = 0
  while (pending.length) {
    const row = pending.pop()!
    if (++visited > 2000 || found.length > 500) {
      throw new Error('Plugin scan exceeds inventory limits')
    }
    let stat
    try {
      stat = await lstat(row.path)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        continue
      }
      throw error
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      continue
    }
    let plugin: SkillLibraryPlugin | null = null
    for (const manifestPath of [
      '.claude-plugin/plugin.json',
      '.codex-plugin/plugin.json',
      'plugin.json'
    ]) {
      try {
        const path = join(row.path, ...manifestPath.split('/'))
        const metadata = await lstat(path)
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 256 * 1024) {
          continue
        }
        plugin = skillLibraryPluginOrigin(
          JSON.parse(await readFile(path, 'utf8')),
          `plugin:${row.owner}`,
          'skills'
        )
        if (plugin) {
          break
        }
      } catch (error) {
        if (
          error instanceof SyntaxError ||
          (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        ) {
          continue
        }
        throw error
      }
    }
    if (plugin) {
      const path = join(row.path, 'skills')
      found.push({
        plugin,
        root: {
          id: `library-plugin-${plugin.id}-${found.length}`,
          label: `${plugin.name}${plugin.version ? ` @ ${plugin.version}` : ''}`,
          path,
          sourceKind: 'plugin',
          providers: [row.provider],
          owner: row.owner
        }
      })
      continue
    }
    if (row.depth >= 5) {
      continue
    }
    for await (const entry of await opendir(row.path)) {
      if (entry.isDirectory() && !['node_modules', '.git', 'skills'].includes(entry.name)) {
        pending.push({ ...row, path: join(row.path, entry.name), depth: row.depth + 1 })
      }
    }
  }
  return found
}
