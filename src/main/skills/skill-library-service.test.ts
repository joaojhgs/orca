import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SkillLibraryService, type SkillLibrarySource } from './skill-library-service'
import { createSkillPackageArchive } from './skill-package-creation'
import { extractSkillPackageArchive } from './skill-package-extraction'

const temporaryRoots: string[] = []
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'orca-library-test-'))
  temporaryRoots.push(root)
  const sourceDirectory = join(root, 'source')
  await mkdir(sourceDirectory)
  await writeFile(
    join(sourceDirectory, 'SKILL.md'),
    '---\nname: sample-skill\ndescription: test\n---\nOriginal instructions\n'
  )
  const source: SkillLibrarySource = {
    hostId: 'local',
    discover: async () => [
      {
        id: 'discovered-one',
        name: 'sample-skill',
        description: 'test',
        providers: ['codex'],
        sourceLabel: 'Test source',
        sourceKind: 'home'
      }
    ],
    package: (candidateId, input) => {
      if (candidateId !== 'discovered-one') {
        throw new Error('bad candidate')
      }
      return createSkillPackageArchive({ ...input, sourceDirectory })
    }
  }
  const service = new SkillLibraryService(join(root, 'library'))
  const importSkill = (addVersion = false) =>
    service.importSelected(
      { hostId: 'local', candidateIds: ['discovered-one'], reviewed: true, addVersion },
      source
    )
  return { root, sourceDirectory, service, source, importSkill }
}

describe('local skill library snapshots', () => {
  it('counts uncatalogued archives against the storage quota without deleting them', async () => {
    const f = await fixture()
    const directory = join(f.service.store.root, 'archives')
    await mkdir(directory, { recursive: true })
    const orphan = join(directory, 'orphan.tar.gz')
    await writeFile(orphan, '')
    await truncate(orphan, 256 * 1024 * 1024)
    expect((await f.importSkill()).results[0].status).toBe('failed')
    expect((await f.service.store.snapshot()).versions).toHaveLength(0)
    expect(await f.service.store.archiveBytes()).toBe(256 * 1024 * 1024)
  })
  it('previews supporting files and rejects a snapshot changed since review', async () => {
    const f = await fixture()
    await writeFile(join(f.sourceDirectory, 'reference.md'), 'Review this reference')
    const preview = await f.service.preview(f.source, 'discovered-one', 'reference.md')
    expect(preview.content).toBe('Review this reference')
    await expect(f.service.preview(f.source, 'discovered-one', '../../etc/passwd')).rejects.toThrow(
      'file-not-found'
    )
    await writeFile(join(f.sourceDirectory, 'reference.md'), 'Changed after review')
    const result = await f.service.importSelected(
      {
        candidateIds: ['discovered-one'],
        reviewed: true,
        expectedDigests: [{ candidateId: 'discovered-one', packageDigest: preview.packageDigest }]
      },
      f.source
    )
    expect(result.results[0].status).toBe('failed')
    expect((await f.service.store.snapshot()).versions).toHaveLength(0)
  })
  it('imports a validated snapshot, persists it, and leaves the source alone', async () => {
    const { root, service, sourceDirectory, importSkill } = await fixture()
    const result = await importSkill()
    expect(result.results[0].status).toBe('imported')
    const catalog = await new SkillLibraryService(join(root, 'library')).store.snapshot()
    expect(catalog.versions).toHaveLength(1)
    expect(catalog.versions[0].origins[0].hostId).toBe('local')
    expect(await readFile(service.archivePath(catalog.versions[0].versionId))).not.toHaveLength(0)
    expect(await readFile(join(sourceDirectory, 'SKILL.md'), 'utf8')).toContain(
      'Original instructions'
    )
  })

  it('deduplicates repeated imports and explicit duplicate selectors', async () => {
    const { service, source, importSkill } = await fixture()
    await importSkill()
    const result = await service.importSelected(
      { candidateIds: ['discovered-one', 'discovered-one'], reviewed: true },
      source
    )
    expect(result.results).toHaveLength(1)
    expect(result.results[0].status).toBe('unchanged')
    expect((await service.store.snapshot()).versions).toHaveLength(1)
  })

  it('requires explicit version creation for same-name different content', async () => {
    const { service, sourceDirectory, importSkill } = await fixture()
    const original = (await importSkill()).results[0].version!
    await writeFile(join(sourceDirectory, 'reference.md'), 'New content')
    expect((await importSkill()).results[0].status).toBe('conflict')
    expect((await service.store.snapshot()).versions).toHaveLength(1)
    const updated = (await importSkill(true)).results[0].version!
    expect(updated.packageId).toBe(original.packageId)
    expect(updated.versionId).not.toBe(original.versionId)
    expect((await service.store.snapshot()).versions).toHaveLength(2)
  })

  it('refuses arbitrary paths, mismatched hosts, and imports without review', async () => {
    const { service, source } = await fixture()
    await expect(
      service.importSelected({ candidateIds: ['/etc/passwd'], reviewed: true }, source)
    ).rejects.toThrow('candidate-not-found')
    await expect(
      service.importSelected(
        { hostId: 'ssh:other', candidateIds: ['discovered-one'], reviewed: true },
        source
      )
    ).rejects.toThrow('source-host-mismatch')
    await expect(
      service.importSelected({ candidateIds: ['discovered-one'] }, source)
    ).rejects.toThrow()
    expect((await service.store.snapshot()).versions).toHaveLength(0)
  })

  it('rejects nested symlinks without exposing file content in errors', async () => {
    const { service, sourceDirectory, importSkill } = await fixture()
    await symlink('/etc/passwd', join(sourceDirectory, 'stolen.txt'))
    const result = await importSkill()
    expect(result.results[0].status).toBe('failed')
    expect(JSON.stringify(result)).not.toContain('root:')
    expect((await service.store.snapshot()).versions).toHaveLength(0)
  })

  it('preserves binary assets and executable script metadata', async () => {
    const { root, sourceDirectory, service, importSkill } = await fixture()
    await writeFile(join(sourceDirectory, 'image.bin'), Buffer.from([0, 255, 13, 10]))
    await writeFile(join(sourceDirectory, 'run.sh'), '#!/bin/sh\necho sample\n')
    await chmod(join(sourceDirectory, 'run.sh'), 0o755)
    const version = (await importSkill()).results[0].version!
    expect(version.files.find((file) => file.path === 'image.bin')?.classification).toBe('binary')
    expect(version.files.find((file) => file.path === 'run.sh')?.executable).toBe(true)
    await extractSkillPackageArchive({
      archivePath: service.archivePath(version.versionId),
      destinationDirectory: join(root, 'extracted'),
      expectedArchiveSha256: version.archiveSha256,
      expectedPackageDigest: version.packageDigest
    })
    expect((await service.store.snapshot()).versions[0].files).toEqual(version.files)
  })

  it('serializes concurrent imports instead of losing catalog updates', async () => {
    const { service, importSkill } = await fixture()
    const results = await Promise.all([importSkill(), importSkill(), importSkill()])
    expect(results.map((result) => result.results[0].status)).toEqual([
      'imported',
      'unchanged',
      'unchanged'
    ])
    expect((await service.store.snapshot()).versions).toHaveLength(1)
  })

  it('fails closed on corrupt persistent data rather than replacing the library', async () => {
    const { service, root, importSkill } = await fixture()
    await importSkill()
    await writeFile(join(root, 'library', 'catalog.json'), '{broken')
    await expect(service.store.snapshot()).rejects.toThrow()
    expect(await readFile(join(root, 'library', 'catalog.json'), 'utf8')).toBe('{broken')
  })
})
