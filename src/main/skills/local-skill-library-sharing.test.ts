import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import { LocalArtifactViewer } from '../artifacts/local-artifact-viewer'
import { SkillLibraryService, type SkillLibrarySource } from './skill-library-service'
import { createSkillPackageArchive } from './skill-package-creation'
import {
  publishLibrarySkills,
  revokeLibraryShare,
  localSkillShareUrl
} from './local-skill-library-sharing'
import { previewLibraryVersion } from './skill-library-snapshot-preview'
import { publishImportedSkillsFromAgent } from './local-agent-skill-sharing'

const roots: string[] = []
const viewers: LocalArtifactViewer[] = []
afterEach(async () => {
  await Promise.all(viewers.splice(0).map((viewer) => viewer.close()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'orca-local-skill-share-'))
  roots.push(root)
  const sourceDirectory = join(root, 'source')
  await mkdir(sourceDirectory)
  await writeFile(
    join(sourceDirectory, 'SKILL.md'),
    '---\nname: sample-skill\ndescription: "<script>unsafe</script>"\n---\nPinned instructions\n'
  )
  await writeFile(join(sourceDirectory, 'run.sh'), '#!/bin/sh\nexit 0\n')
  await chmod(join(sourceDirectory, 'run.sh'), 0o755)
  const source: SkillLibrarySource = {
    hostId: 'ssh:fixture',
    discover: async () => [
      {
        id: 'fixture',
        name: 'sample-skill',
        description: 'Fixture',
        providers: ['codex'],
        sourceLabel: 'Fixture SSH host',
        sourceKind: 'home'
      }
    ],
    package: (_id, params) => createSkillPackageArchive({ ...params, sourceDirectory })
  }
  const library = new SkillLibraryService(join(root, 'skill-library', 'fixture-profile'))
  await library.importSelected(
    { hostId: 'ssh:fixture', candidateIds: ['fixture'], reviewed: true },
    source
  )
  const version = (await library.store.snapshot()).versions[0]
  if (!version) {
    throw new Error('Fixture import failed')
  }
  const publish = () =>
    publishLibrarySkills(library, {
      versionIds: [version.versionId],
      bundleName: 'fixture-bundle',
      reviewed: true
    })
  return { root, library, sourceDirectory, version, publish }
}
describe('server-local imported skill sharing', () => {
  it('shares only reviewed imported versions and preserves executable metadata', async () => {
    const f = await fixture()
    await expect(
      publishLibrarySkills(f.library, {
        versionIds: [randomUUID()],
        bundleName: 'test',
        reviewed: true
      })
    ).rejects.toThrow('Only imported')
    await expect(
      publishLibrarySkills(f.library, {
        versionIds: [f.version.versionId],
        bundleName: 'test',
        reviewed: false
      })
    ).rejects.toThrow()
    const share = await f.publish()
    expect(share.manifest.skills[0].digest).toBe(f.version.packageDigest)
    expect(share.manifest.skills[0].files.find((file) => file.path === 'run.sh')?.executable).toBe(
      true
    )
    expect((await f.library.store.snapshot()).shares?.[0].id).toBe(share.id)
    const bytes = await readFile(join(f.library.store.root, 'published', `${share.id}.tar.gz`))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(share.archiveSha256)
  })
  it('previews the pinned archive even after the original disappears and rejects traversal', async () => {
    const f = await fixture()
    await rm(f.sourceDirectory, { recursive: true })
    expect((await previewLibraryVersion(f.library, f.version.versionId)).content).toContain(
      'Pinned instructions'
    )
    await expect(
      previewLibraryVersion(f.library, f.version.versionId, '../../outside')
    ).rejects.toThrow('not in this imported')
    expect((await f.publish()).manifest.skills[0].digest).toBe(f.version.packageDigest)
  })
  it('keeps published snapshots after deleting the imported version and revokes only the owned archive', async () => {
    const f = await fixture()
    const share = await f.publish()
    const archive = join(f.library.store.root, 'published', `${share.id}.tar.gz`)
    await f.library.deleteVersion(f.version.versionId)
    expect(await readFile(archive)).not.toHaveLength(0)
    await expect(revokeLibraryShare(f.library, '../outside')).rejects.toThrow()
    await revokeLibraryShare(f.library, share.id)
    expect((await f.library.store.snapshot()).shares).toEqual([])
    await expect(readFile(archive)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(f.sourceDirectory, 'SKILL.md'), 'utf8')).toContain(
      'Pinned instructions'
    )
  })
  it('rejects symlinked publish storage', async () => {
    const f = await fixture()
    await symlink(f.sourceDirectory, join(f.library.store.root, 'published'), 'dir')
    await expect(f.publish()).rejects.toThrow('Invalid published')
  })
  it('serves local pages, verified bundles and manifests without Cloud, and closes revoked links', async () => {
    const f = await fixture()
    const share = await f.publish()
    const viewer = new LocalArtifactViewer(f.root, { bindHost: '127.0.0.1', port: 0 })
    viewers.push(viewer)
    const origin = await viewer.start()
    const url = localSkillShareUrl(origin, 'fixture-profile', share)
    const response = await fetch(url)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).not.toContain('allow-scripts')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const html = await response.text()
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    const archive = await fetch(`${url}/archive`)
    expect(archive.status).toBe(200)
    const bytes = Buffer.from(await archive.arrayBuffer())
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(share.archiveSha256)
    expect((await (await fetch(`${url}/manifest`)).json()).archiveSha256).toBe(share.archiveSha256)
    expect((await fetch(url, { method: 'HEAD' })).status).toBe(200)
    expect((await fetch(url, { method: 'POST' })).status).toBe(405)
    expect((await fetch(url.replace(share.token, '0'.repeat(64)))).status).toBe(404)
    await writeFile(join(f.library.store.root, 'published', `${share.id}.tar.gz`), 'tampered')
    expect((await fetch(`${url}/archive`)).status).toBe(404)
    await revokeLibraryShare(f.library, share.id)
    expect((await fetch(url)).status).toBe(404)
  })
  it('routes agent share selectors to imported versions, never scan candidates', async () => {
    const f = await fixture()
    await expect(
      publishImportedSkillsFromAgent(
        f.library,
        { skillSelectors: ['fixture'], bundleName: 'test', releaseNotes: '' },
        'http://localhost'
      )
    ).rejects.toMatchObject({ code: 'agent_skill_selector_not_found' })
    const result = await publishImportedSkillsFromAgent(
      f.library,
      { skillSelectors: ['sample-skill'], bundleName: 'test', releaseNotes: '' },
      'http://localhost'
    )
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.value.selectedSkills[0].id).toBe(f.version.versionId)
    }
  })
})
