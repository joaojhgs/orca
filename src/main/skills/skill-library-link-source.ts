import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { validateSkillPackagePath } from '../../shared/skill-package-manifest'
import { summarizeSkillMarkdown } from '../../shared/skill-metadata'
import type { SkillLibraryCandidate } from '../../shared/skill-library-contract'
import { createSkillPackageArchive } from './skill-package-creation'
import {
  githubSkillApi,
  parseGithubSkillLink,
  type GithubSkillLocation,
  type GithubSkillTree
} from './skill-library-github-api'
import type { SkillLibrarySource, SkillLibraryService } from './skill-library-service'

const SOURCE_LEASE_MS = 30 * 60 * 1000
type CandidateSource = {
  candidate: SkillLibraryCandidate
  repo: string
  folder: string
  tree: GithubSkillTree
}
type SourceLease = { source: SkillLibrarySource; dispose(): Promise<void> }
const sources = new WeakMap<SkillLibraryService, Map<string, SourceLease>>()

export function resolveLinkSkillSource(
  library: SkillLibraryService,
  hostId: string
): SkillLibrarySource {
  const source = sources.get(library)?.get(hostId)?.source
  if (!source) {
    throw new Error('Link review expired or server restarted. Scan the link and review again.')
  }
  return source
}

// Marketplace references are data, not executable plugin installation instructions.
const MarketplaceSchema = z.object({
  plugins: z
    .array(
      z.object({
        source: z.union([
          z.string(),
          z.object({ source: z.string(), repo: z.string().optional(), url: z.string().optional() })
        ])
      })
    )
    .max(100)
})

export async function discoverLinkedSkills(
  library: SkillLibraryService,
  url: string,
  api = githubSkillApi()
) {
  const initial = parseGithubSkillLink(url)
  const locations: { location: GithubSkillLocation; tree: GithubSkillTree }[] = []
  const first = await api.tree(initial)
  locations.push({ location: initial, tree: first })
  const marketplace = first.tree.find(
    (entry) => entry.type === 'blob' && entry.path === '.claude-plugin/marketplace.json'
  )
  if (marketplace && !initial.prefix && !initial.name) {
    const parsed = MarketplaceSchema.safeParse(
      JSON.parse(
        (
          await api.blob(initial.repo, marketplace.sha, 256 * 1024, {
            commit: first.commitSha,
            path: marketplace.path
          })
        ).toString('utf8')
      )
    )
    if (!parsed.success) {
      throw new Error(
        'Unsupported plugin marketplace manifest. Use a plugin repository link instead.'
      )
    }
    const repositories = new Set([initial.repo])
    for (const plugin of parsed.data.plugins) {
      const source = plugin.source
      let link: string | undefined
      if (typeof source === 'string') {
        if (source.startsWith('https://github.com/')) {
          link = source
        } else if (!source.startsWith('./')) {
          throw new Error(
            'Marketplace has unsupported external plugin sources; use their GitHub links individually.'
          )
        }
      } else if (source.source === 'github' && source.repo) {
        link = `https://github.com/${source.repo}`
      } else if (source.source === 'url' && source.url) {
        link = source.url
      } else {
        throw new Error(
          'Marketplace has unsupported external plugin sources; use their GitHub links individually.'
        )
      }
      if (!link) {
        continue
      }
      const location = parseGithubSkillLink(link)
      if (repositories.has(location.repo)) {
        continue
      }
      if (repositories.size >= 10) {
        throw new Error(
          'Marketplace exceeds 10 repositories. Import individual plugin links instead.'
        )
      }
      repositories.add(location.repo)
      locations.push({ location, tree: await api.tree(location) })
    }
  }
  const found: CandidateSource[] = []
  for (const { location, tree } of locations) {
    for (const entry of tree.tree.filter(
      (row) => row.type === 'blob' && (row.path === 'SKILL.md' || row.path.endsWith('/SKILL.md'))
    )) {
      const folder = entry.path === 'SKILL.md' ? '' : entry.path.slice(0, -9)
      if (
        location.prefix &&
        folder !== location.prefix &&
        !folder.startsWith(`${location.prefix}/`)
      ) {
        continue
      }
      if (location.name && folder.split('/').at(-1) !== location.name) {
        continue
      }
      if (!['100644', '100755'].includes(entry.mode) || (entry.size ?? 0) > 1024 * 1024) {
        throw new Error('Unsafe or oversized SKILL.md in source')
      }
      const summary = summarizeSkillMarkdown(
        (
          await api.blob(location.repo, entry.sha, 1024 * 1024, {
            commit: tree.commitSha,
            path: entry.path
          })
        ).toString('utf8')
      )
      if (!summary.name) {
        throw new Error(`Skill at ${location.repo}/${folder} has no name`)
      }
      const id = createHash('sha256').update(`${location.repo}:${tree.sha}:${folder}`).digest('hex')
      found.push({
        candidate: {
          id,
          name: summary.name,
          description: summary.description ?? null,
          sourceLabel: `${location.repo}/${folder} @ ${tree.sha.slice(0, 12)}`.slice(0, 500),
          sourceKind: 'link',
          providers: []
        },
        repo: location.repo,
        folder,
        tree
      })
      if (found.length > 500) {
        throw new Error('Source exceeds 500 skills; use a narrower folder link')
      }
    }
  }
  if (!found.length) {
    throw new Error('No SKILL.md packages found in this source')
  }
  const hostId = `url:${randomUUID()}`
  const staging = join(library.store.root, 'staging')
  await mkdir(staging, { recursive: true, mode: 0o700 })
  const directory = await mkdtemp(join(staging, 'link-'))
  const downloaded = new Map<string, Promise<string>>()
  let stagedBytes = 0
  const download = async (row: CandidateSource) => {
    const root = join(directory, row.candidate.id)
    const prefix = row.folder ? `${row.folder}/` : ''
    const entries = row.tree.tree.filter(
      (entry) => entry.path.startsWith(prefix) && entry.type !== 'tree'
    )
    if (!entries.length || entries.length > 512) {
      throw new Error('Skill exceeds package file limits')
    }
    let size = 0
    for (const entry of entries) {
      if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) {
        throw new Error('Symlinks and submodules are not imported')
      }
      const path = entry.path.slice(prefix.length)
      validateSkillPackagePath(path)
      if (typeof entry.size !== 'number' || entry.size > 4 * 1024 * 1024) {
        throw new Error('Skill file exceeds size limits')
      }
      size += entry.size
      if (size > 32 * 1024 * 1024) {
        throw new Error('Skill exceeds package size limits')
      }
    }
    if (stagedBytes + size > 128 * 1024 * 1024) {
      throw new Error('Link review exceeds 128 MiB. Import a smaller selection.')
    }
    stagedBytes += size
    for (const entry of entries) {
      const path = join(root, entry.path.slice(prefix.length))
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await writeFile(
        path,
        await api.blob(row.repo, entry.sha, undefined, {
          commit: row.tree.commitSha,
          path: entry.path
        }),
        { flag: 'wx', mode: entry.mode === '100755' ? 0o700 : 0o600 }
      )
      await chmod(path, entry.mode === '100755' ? 0o700 : 0o600)
    }
    return root
  }
  const source: SkillLibrarySource = {
    hostId,
    discover: async () => found.map((row) => row.candidate),
    package: async (candidateId, input) => {
      const row = found.find((entry) => entry.candidate.id === candidateId)
      if (!row) {
        throw new Error('Link candidate not found')
      }
      let pending = downloaded.get(candidateId)
      if (!pending) {
        pending = download(row).catch(async (error) => {
          downloaded.delete(candidateId)
          await rm(join(directory, candidateId), { recursive: true, force: true })
          throw error
        })
        downloaded.set(candidateId, pending)
      }
      return createSkillPackageArchive({ ...input, sourceDirectory: await pending })
    }
  }
  let leases = sources.get(library)
  if (!leases) {
    leases = new Map()
    sources.set(library, leases)
  }
  // Bound scratch storage and reject expired reviews instead of substituting a new source.
  if (leases.size >= 4) {
    await leases.values().next().value?.dispose()
  }
  const owner = leases
  const timer = setTimeout(() => {
    void lease.dispose()
  }, SOURCE_LEASE_MS)
  timer.unref()
  const lease: SourceLease = {
    source,
    dispose: async () => {
      clearTimeout(timer)
      owner.delete(hostId)
      await Promise.allSettled(downloaded.values())
      await rm(directory, { recursive: true, force: true })
    }
  }
  leases.set(hostId, lease)
  return { hostId, label: 'Linked source', candidates: await source.discover() }
}
