import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { discoverLinkedSkills, resolveLinkSkillSource } from './skill-library-link-source'
import { parseGithubSkillLink, type GithubSkillTree } from './skill-library-github-api'
import { SkillLibraryService } from './skill-library-service'
import { gitBlobSha } from './skill-git-tree-identity'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'orca-link-import-test-'))
  roots.push(root)
  const library = new SkillLibraryService(join(root, 'library'))
  const markdown = Buffer.from(
    '---\nname: safe-fixture\ndescription: Fixture skill\n---\nReview me.\n'
  )
  const script = Buffer.from('#!/bin/sh\necho DO-NOT-RUN\n')
  const blobs = new Map([
    [gitBlobSha(markdown).toString('hex'), markdown],
    [gitBlobSha(script).toString('hex'), script]
  ])
  const tree: GithubSkillTree = {
    sha: 'a'.repeat(40),
    commitSha: 'b'.repeat(40),
    truncated: false,
    tree: [
      {
        path: 'skills/safe-fixture/SKILL.md',
        mode: '100644',
        type: 'blob',
        sha: gitBlobSha(markdown).toString('hex'),
        size: markdown.length
      },
      {
        path: 'skills/safe-fixture/run.sh',
        mode: '100755',
        type: 'blob',
        sha: gitBlobSha(script).toString('hex'),
        size: script.length
      }
    ]
  }
  const api = {
    tree: async () => tree,
    blob: async (_repo: string, sha: string) => {
      const data = blobs.get(sha)
      if (!data) {
        throw new Error('Missing fixture blob')
      }
      return data
    }
  }
  return { library, tree, api }
}
it.each([
  ['https://github.com/example/skills', { repo: 'example/skills', prefix: '' }],
  [
    'https://github.com/example/skills/tree/main/skills/safe-fixture',
    { repo: 'example/skills', ref: 'main', prefix: 'skills/safe-fixture' }
  ],
  [
    'https://github.com/example/skills/blob/main/skills/safe-fixture/SKILL.md',
    { repo: 'example/skills', ref: 'main', prefix: 'skills/safe-fixture' }
  ],
  [
    'https://skills.sh/example/skills/safe-fixture',
    { repo: 'example/skills', prefix: '', name: 'safe-fixture' }
  ]
])('resolves supported source %s', (url, location) =>
  expect(parseGithubSkillLink(url)).toEqual(location)
)
it.each([
  'http://github.com/example/skills',
  'https://169.254.169.254/metadata',
  'https://user:secret@github.com/example/skills',
  'https://github.com:8443/example/skills',
  'https://github.com/example/skills?token=secret'
])('refuses unsafe source %s', (url) => {
  expect(() => parseGithubSkillLink(url)).toThrow()
})
it('imports a reviewed plugin skill into immutable local storage, preserves executable files without running them', async () => {
  const f = await fixture()
  const result = await discoverLinkedSkills(
    f.library,
    'https://skills.sh/example/plugins/safe-fixture',
    f.api
  )
  expect(result.candidates.map((row) => row.name)).toEqual(['safe-fixture'])
  const source = resolveLinkSkillSource(f.library, result.hostId)
  const candidate = result.candidates[0]!
  const preview = await f.library.preview(source, candidate.id)
  expect(preview.files.find((file) => file.path === 'run.sh')?.executable).toBe(true)
  const imported = await f.library.importSelected(
    {
      hostId: result.hostId,
      candidateIds: [candidate.id],
      reviewed: true,
      expectedDigests: [{ candidateId: candidate.id, packageDigest: preview.packageDigest }]
    },
    source
  )
  expect(imported.results[0]?.status).toBe('imported')
  const version = (await f.library.store.snapshot()).versions[0]!
  expect((await readFile(f.library.archivePath(version.versionId))).length).toBeGreaterThan(0)
  expect(version.origins[0]?.hostId).toBe(result.hostId)
  expect(() =>
    resolveLinkSkillSource(
      new SkillLibraryService(join(f.library.store.root, 'other')),
      result.hostId
    )
  ).toThrow('expired')
})
it('rejects a symlink and unsafe paths before creating an imported snapshot', async () => {
  const f = await fixture()
  f.tree.tree.push({
    path: 'skills/safe-fixture/escape',
    mode: '120000',
    type: 'blob',
    sha: 'c'.repeat(40),
    size: 5
  })
  const result = await discoverLinkedSkills(f.library, 'https://github.com/example/skills', f.api)
  const source = resolveLinkSkillSource(f.library, result.hostId)
  await expect(f.library.preview(source, result.candidates[0]!.id)).rejects.toThrow('Symlinks')
  expect((await f.library.store.snapshot()).versions).toHaveLength(0)
})
