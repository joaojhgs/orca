import { dirname } from 'node:path/posix'
import type { GithubSkillTree, githubSkillApi } from './skill-library-github-api'
import { skillLibraryPluginOrigin } from './skill-library-plugin-origin'

export async function linkedSkillPlugins(
  repo: string,
  tree: GithubSkillTree,
  api: ReturnType<typeof githubSkillApi>
) {
  const roots: { directory: string; manifest: unknown }[] = []
  for (const entry of tree.tree) {
    const marker = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'plugin.json'].find(
      (path) => entry.path === path || entry.path.endsWith(`/${path}`)
    )
    if (!marker || entry.type !== 'blob') {
      continue
    }
    if (
      roots.length >= 100 ||
      !['100644', '100755'].includes(entry.mode) ||
      (entry.size ?? 0) > 256 * 1024
    ) {
      throw new Error('Plugin metadata exceeds safety limits')
    }
    const directory = entry.path.slice(0, -marker.length).replace(/\/$/, '')
    if (roots.some((row) => row.directory === directory)) {
      continue
    }
    const manifest: unknown = JSON.parse(
      (
        await api.blob(repo, entry.sha, 256 * 1024, {
          commit: tree.commitSha,
          path: entry.path
        })
      ).toString('utf8')
    )
    if (skillLibraryPluginOrigin(manifest, `https://github.com/${repo.toLowerCase()}`, 'skills')) {
      roots.push({ directory, manifest })
    }
  }
  return (skillFolder: string) => {
    const root = roots
      .filter((row) => !row.directory || skillFolder.startsWith(`${row.directory}/`))
      .sort((a, b) => b.directory.length - a.directory.length)[0]
    if (!root) {
      return null
    }
    const memberPath = root.directory ? skillFolder.slice(root.directory.length + 1) : skillFolder
    // A plugin owns its skill tree, not arbitrary neighbouring packages.
    if (dirname(memberPath) !== 'skills' && !memberPath.startsWith('skills/')) {
      return null
    }
    return skillLibraryPluginOrigin(
      root.manifest,
      `https://github.com/${repo.toLowerCase()}`,
      memberPath
    )
  }
}
