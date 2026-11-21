import { z } from 'zod'
import { fixedOriginFetch } from '../lib/fixed-origin-fetch'
import { gitBlobSha } from './skill-git-tree-identity'

const TreeSchema = z.object({
  sha: z.string().regex(/^[a-f0-9]{40}$/),
  truncated: z.boolean(),
  tree: z
    .array(
      z.object({
        path: z.string(),
        mode: z.string(),
        type: z.string(),
        sha: z.string().regex(/^[a-f0-9]{40}$/),
        size: z.number().optional()
      })
    )
    .max(20000)
})
export type GithubSkillTree = z.infer<typeof TreeSchema> & { commitSha: string }
export type GithubSkillLocation = { repo: string; ref?: string; prefix: string; name?: string }

export function parseGithubSkillLink(input: string): GithubSkillLocation {
  const url = new URL(input)
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Use a public HTTPS GitHub or skills.sh link without credentials or query parameters.'
    )
  }
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const [owner, repository] = parts
  if (
    !owner ||
    !repository ||
    !/^[a-zA-Z0-9_.-]+$/.test(owner) ||
    !/^[a-zA-Z0-9_.-]+$/.test(repository) ||
    [owner, repository].some((row) => row === '.' || row === '..')
  ) {
    throw new Error('Invalid repository link')
  }
  const repo = `${owner}/${repository.replace(/\.git$/, '')}`
  if (url.hostname === 'skills.sh' && parts.length <= 3) {
    return { repo, prefix: '', name: parts[2] }
  }
  if (url.hostname !== 'github.com') {
    throw new Error(
      'This source is not supported. Paste its public GitHub repository or skill folder link.'
    )
  }
  if (parts.length === 2) {
    return { repo, prefix: '' }
  }
  if (!['tree', 'blob'].includes(parts[2] ?? '') || !parts[3]) {
    throw new Error('Use a repository, tree, or SKILL.md file link')
  }
  const path = parts.slice(4)
  if (parts[2] === 'blob') {
    if (path.at(-1) !== 'SKILL.md') {
      throw new Error('File links must point to SKILL.md')
    }
    path.pop()
  }
  return { repo, ref: parts[3], prefix: path.join('/') }
}

export function githubSkillApi(
  fetcher: typeof fetch = fixedOriginFetch(
    'https://api.github.com',
    process.env.ORCA_SKILL_GITHUB_TRANSPORT_URL
  )
) {
  const rawFetch = fixedOriginFetch(
    'https://raw.githubusercontent.com',
    process.env.ORCA_SKILL_RAW_TRANSPORT_URL
  )
  const blobs = new Map<string, Buffer>()
  let cachedBytes = 0
  const cache = (key: string, data: Buffer) => {
    if (
      data.length <= 1024 * 1024 &&
      cachedBytes + data.length <= 8 * 1024 * 1024 &&
      !blobs.has(key)
    ) {
      blobs.set(key, data)
      cachedBytes += data.length
    }
  }
  const get = async (path: string, limit: number): Promise<unknown> => {
    const response = await fetcher(`https://api.github.com${path}`, {
      headers: { accept: 'application/vnd.github+json' },
      redirect: 'error',
      signal: AbortSignal.timeout(30000)
    })
    if (!response.ok) {
      throw new Error(
        `GitHub source unavailable (HTTP ${response.status}); check the link or retry after the API rate limit resets.`
      )
    }
    if (!response.body) {
      throw new Error('GitHub response is empty')
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) {
          break
        }
        bytes += value.byteLength
        if (bytes > limit) {
          throw new Error('GitHub source exceeds download limits')
        }
        chunks.push(value)
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
  return {
    tree: async (location: GithubSkillLocation) => {
      const ref =
        location.ref ??
        z
          .object({ default_branch: z.string() })
          .parse(await get(`/repos/${location.repo}`, 128 * 1024)).default_branch
      const commit = z
        .object({ sha: z.string().regex(/^[a-f0-9]{40}$/) })
        .parse(await get(`/repos/${location.repo}/commits/${encodeURIComponent(ref)}`, 512 * 1024))
      const tree = TreeSchema.parse(
        await get(`/repos/${location.repo}/git/trees/${commit.sha}?recursive=1`, 4 * 1024 * 1024)
      )
      if (tree.truncated) {
        throw new Error(
          'Repository inventory is truncated. Use a smaller plugin/skills repository.'
        )
      }
      return { ...tree, commitSha: commit.sha }
    },
    blob: async (
      repo: string,
      sha: string,
      maximum = 4 * 1024 * 1024,
      raw?: { commit: string; path: string }
    ) => {
      const cached = blobs.get(`${repo}:${sha}`)
      if (cached) {
        if (cached.length > maximum) {
          throw new Error('Skill file exceeds download limits')
        }
        return cached
      }
      if (raw) {
        const response = await rawFetch(
          `https://raw.githubusercontent.com/${repo}/${raw.commit}/${raw.path.split('/').map(encodeURIComponent).join('/')}`,
          {
            redirect: 'error',
            signal: AbortSignal.timeout(30000)
          }
        )
        if (!response.ok || !response.body) {
          throw new Error(`GitHub skill file unavailable (HTTP ${response.status})`)
        }
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let bytes = 0
        try {
          for (;;) {
            const { value, done } = await reader.read()
            if (done) {
              break
            }
            bytes += value.byteLength
            if (bytes > maximum) {
              throw new Error('Skill file exceeds download limits')
            }
            chunks.push(value)
          }
          const data = Buffer.concat(chunks)
          if (gitBlobSha(data).toString('hex') !== sha) {
            throw new Error('GitHub blob identity mismatch')
          }
          // Bound the discovery cache; package downloads are also staged on disk.
          cache(`${repo}:${sha}`, data)
          return data
        } finally {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
      }
      const blob = z
        .object({
          encoding: z.literal('base64'),
          content: z.string(),
          size: z.number().int().nonnegative()
        })
        .parse(await get(`/repos/${repo}/git/blobs/${sha}`, Math.ceil(maximum * 1.5) + 4096))
      if (blob.size > maximum) {
        throw new Error('Skill file exceeds download limits')
      }
      const data = Buffer.from(blob.content, 'base64')
      if (data.length !== blob.size || gitBlobSha(data).toString('hex') !== sha) {
        throw new Error('GitHub blob identity mismatch')
      }
      cache(`${repo}:${sha}`, data)
      return data
    }
  }
}
