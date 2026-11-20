import { randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { SkillLibraryService, SkillLibrarySource } from './skill-library-service'
import { retainLibraryLinkSource } from './skill-library-link-source'
import { extractSkillBundleArchive } from './skill-bundle-extraction'
import { createSkillPackageArchive } from './skill-package-creation'

export async function discoverPublishedLibrarySkills(
  library: SkillLibraryService,
  input: string,
  viewerOrigin: string | null
) {
  const url = new URL(input)
  if (
    !viewerOrigin ||
    url.origin !== new URL(viewerOrigin).origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return null
  }
  const match = /^\/skills\/share\/([\w-]+)\/([a-f0-9-]{36})\/([a-f0-9]{64})\/?$/.exec(url.pathname)
  if (!match) {
    return null
  }
  if (match[1] !== library.store.root.split(/[\\/]/).at(-1)) {
    throw new Error('Import this link in its owning Orca profile.')
  }
  const catalog = await library.store.snapshot()
  const share = catalog.shares?.find((row) => row.id === match[2])
  if (!share || !timingSafeEqual(Buffer.from(share.token), Buffer.from(match[3]!))) {
    throw new Error('Skill share is unavailable or revoked.')
  }
  const hostId = `url:${randomUUID()}`
  const candidates = share.manifest.skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    sourceKind: 'local-share',
    sourceLabel: share.manifest.bundleName,
    providers: [],
    ...(share.pluginOrigins?.find((row) => row.skillId === skill.id)
      ? { plugin: share.pluginOrigins.find((row) => row.skillId === skill.id)!.plugin }
      : {})
  }))
  await mkdir(join(library.store.root, 'staging'), { recursive: true, mode: 0o700 })
  const directory = await mkdtemp(join(library.store.root, 'staging', 'shared-review-'))
  let extracted: ReturnType<typeof extractSkillBundleArchive> | null = null
  const source: SkillLibrarySource = {
    hostId,
    discover: async () => candidates,
    package: async (candidateId, input) => {
      const skill = share.manifest.skills.find((row) => row.id === candidateId)
      if (!skill) {
        throw new Error('Shared skill is not in the pinned bundle')
      }
      extracted ??= extractSkillBundleArchive({
        archivePath: join(library.store.root, 'published', `${share.id}.tar.gz`),
        destinationDirectory: join(directory, 'verified'),
        expectedArchiveSha256: share.archiveSha256,
        expectedBundleDigest: share.manifest.bundleDigest,
        expectedPackageId: share.manifest.packageId,
        expectedVersionId: share.manifest.versionId
      })
      const bundle = await extracted
      return createSkillPackageArchive({
        ...input,
        sourceDirectory: join(bundle.skillsDirectory, skill.name)
      })
    }
  }
  await retainLibraryLinkSource(library, source, async () => {
    await extracted?.catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  })
  return { hostId, label: share.manifest.bundleName, candidates }
}
