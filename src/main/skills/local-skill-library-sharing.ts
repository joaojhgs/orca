import { randomBytes, randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, rename, rm, opendir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  LocalSkillPublishParams,
  LocalSkillRevokeParams,
  type LocalSkillShare
} from '../../shared/local-skill-sharing'
import type { SkillLibraryService } from './skill-library-service'
import { extractLibraryVersion } from './skill-library-snapshot-preview'
import { createSkillBundleArchive, type SkillBundleSource } from './skill-bundle-creation'

export function localSkillShareUrl(origin: string, profileId: string, share: LocalSkillShare) {
  return `${origin}/skills/share/${encodeURIComponent(profileId)}/${share.id}/${share.token}`
}

export async function publishLibrarySkills(library: SkillLibraryService, input: unknown) {
  const request = LocalSkillPublishParams.parse(input)
  return library.store.transact(async (catalog) => {
    const versions = [...new Set(request.versionIds)].map((id) => {
      const version = catalog.versions.find((row) => row.versionId === id)
      if (!version) {
        throw new Error('Only imported skill versions can be shared. Refresh the library.')
      }
      return version
    })
    if ((catalog.shares?.length ?? 0) >= 128) {
      throw new Error('Skill link limit reached. Revoke unused links.')
    }
    const published = join(library.store.root, 'published')
    await mkdir(published, { recursive: true, mode: 0o700 })
    const dir = await lstat(published)
    if (!dir.isDirectory() || dir.isSymbolicLink()) {
      throw new Error('Invalid published skill directory')
    }
    let bytes = 0,
      count = 0
    for await (const entry of await opendir(published)) {
      const stat = await lstat(join(published, entry.name))
      if (!stat.isFile() || stat.isSymbolicLink() || ++count > 128) {
        throw new Error('Invalid published skill storage')
      }
      bytes += stat.size
    }
    await mkdir(join(library.store.root, 'staging'), { recursive: true, mode: 0o700 })
    const staging = await mkdtemp(join(library.store.root, 'staging', 'publish-'))
    try {
      const sources: SkillBundleSource[] = []
      for (const version of versions) {
        const extracted = await extractLibraryVersion(
          library,
          version,
          join(staging, version.versionId)
        )
        sources.push({
          id: version.versionId,
          sourceDirectory: extracted.skillDirectory,
          executablePaths: new Set(
            version.files.filter((file) => file.executable).map((file) => file.path)
          )
        })
      }
      const id = randomUUID()
      const created = await createSkillBundleArchive({
        sources,
        archivePath: join(staging, 'bundle.tar.gz'),
        packageId: randomUUID(),
        versionId: randomUUID(),
        bundleName: request.bundleName
      })
      if (bytes + created.compressedBytes > 256 * 1024 * 1024) {
        throw new Error('Published skill storage limit reached')
      }
      const share: LocalSkillShare = {
        id,
        token: randomBytes(32).toString('hex'),
        versionIds: versions.map((version) => version.versionId),
        createdAt: new Date().toISOString(),
        manifest: created.manifest,
        archiveSha256: created.archiveSha256,
        compressedBytes: created.compressedBytes
      }
      await rename(created.archivePath, join(published, `${id}.tar.gz`))
      catalog.shares ??= []
      catalog.shares.push(share)
      return share
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  })
}

export async function revokeLibraryShare(library: SkillLibraryService, shareId: string) {
  LocalSkillRevokeParams.parse({ shareId })
  await library.store.transact(async (catalog) => {
    catalog.shares = (catalog.shares ?? []).filter((share) => share.id !== shareId)
  })
  await rm(join(library.store.root, 'published', `${shareId}.tar.gz`), { force: true })
  return { revoked: true }
}
