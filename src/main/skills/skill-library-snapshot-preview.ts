import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { extractSkillPackageArchive } from './skill-package-extraction'
import type { SkillLibraryService } from './skill-library-service'
import type { SkillLibraryPreview, SkillLibraryVersion } from '../../shared/skill-library-contract'

export async function extractLibraryVersion(
  library: SkillLibraryService,
  version: SkillLibraryVersion,
  destinationDirectory: string
) {
  return extractSkillPackageArchive({
    archivePath: library.archivePath(version.versionId),
    destinationDirectory,
    expectedArchiveSha256: version.archiveSha256,
    expectedPackageDigest: version.packageDigest,
    expectedPackageId: version.packageId,
    expectedVersionId: version.versionId
  })
}

export async function previewLibraryVersion(
  library: SkillLibraryService,
  versionId: string,
  filePath = 'SKILL.md'
): Promise<SkillLibraryPreview> {
  return library.store.transact(async (catalog) => {
    const version = catalog.versions.find((row) => row.versionId === versionId)
    if (!version) {
      throw new Error('Imported skill version not found. Refresh the library.')
    }
    await mkdir(join(library.store.root, 'staging'), { recursive: true, mode: 0o700 })
    const staging = await mkdtemp(join(library.store.root, 'staging', 'saved-review-'))
    try {
      const extracted = await extractLibraryVersion(library, version, join(staging, 'verified'))
      const file = version.files.find((row) => row.path === filePath)
      if (!file) {
        throw new Error('The requested file is not in this imported snapshot.')
      }
      return {
        candidate: {
          id: version.versionId,
          name: version.name,
          description: version.description,
          providers: [],
          sourceLabel: 'Imported snapshot',
          sourceKind: 'library'
        },
        packageDigest: version.packageDigest,
        files: version.files,
        filePath,
        content:
          file.classification === 'text' && file.size <= 1024 * 1024
            ? (await readFile(join(extracted.skillDirectory, filePath), 'utf8')).slice(0, 32768)
            : null,
        truncated: file.size > 32768
      }
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }, false)
}
