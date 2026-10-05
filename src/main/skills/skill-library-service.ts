import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  SkillLibraryImportParams,
  SkillLibraryIdSchema,
  type SkillLibraryCandidate,
  type SkillLibraryVersion
} from '../../shared/skill-library-contract'
import type { CreatedSkillPackage } from './skill-package-creation'
import { extractSkillPackageArchive } from './skill-package-extraction'
import { SkillLibraryStore } from './skill-library-store'

export type SkillLibrarySource = {
  hostId: string
  discover(): Promise<SkillLibraryCandidate[]>
  package(
    candidateId: string,
    input: { packageId: string; versionId: string; archivePath: string }
  ): Promise<CreatedSkillPackage>
}

export class SkillLibraryService {
  readonly store: SkillLibraryStore
  constructor(root: string) {
    this.store = new SkillLibraryStore(root)
  }

  archivePath(versionId: string): string {
    SkillLibraryIdSchema.parse(versionId)
    return join(this.store.root, 'archives', `${versionId}.tar.gz`)
  }

  async preview(source: SkillLibrarySource, candidateId: string, filePath = 'SKILL.md') {
    const candidate = (await source.discover()).find((row) => row.id === candidateId)
    if (!candidate) {
      throw new Error('skill-library-candidate-not-found')
    }
    await mkdir(join(this.store.root, 'staging'), { recursive: true, mode: 0o700 })
    const directory = await mkdtemp(join(this.store.root, 'staging', 'review-'))
    try {
      const created = await source.package(candidateId, {
        packageId: randomUUID(),
        versionId: randomUUID(),
        archivePath: join(directory, 'package.tar.gz')
      })
      const extracted = await extractSkillPackageArchive({
        archivePath: created.archivePath,
        destinationDirectory: join(directory, 'verified'),
        expectedArchiveSha256: created.archiveSha256,
        expectedPackageDigest: created.manifest.packageDigest
      })
      const file = extracted.manifest.files.find((row) => row.path === filePath)
      if (!file) {
        throw new Error('skill-library-file-not-found')
      }
      const content =
        file.classification === 'text' && file.size <= 1024 * 1024
          ? (await readFile(join(extracted.skillDirectory, file.path), 'utf8')).slice(0, 32768)
          : null
      return {
        candidate,
        packageDigest: extracted.manifest.packageDigest,
        files: extracted.manifest.files,
        filePath,
        content,
        truncated: file.size > 32768
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  async deleteVersion(versionId: string): Promise<{ deleted: true }> {
    SkillLibraryIdSchema.parse(versionId)
    await this.store.transact(async (catalog) => {
      if (
        catalog.assignments.some((row) => row.versionId === versionId && row.status !== 'removed')
      ) {
        throw new Error('skill-library-version-still-assigned')
      }
      if (!catalog.versions.some((row) => row.versionId === versionId)) {
        throw new Error('skill-library-version-not-found')
      }
      catalog.versions = catalog.versions.filter((row) => row.versionId !== versionId)
      catalog.assignments = catalog.assignments.filter((row) => row.versionId !== versionId)
    })
    await rm(this.archivePath(versionId), { force: true })
    return { deleted: true }
  }

  async importSelected(input: unknown, source: SkillLibrarySource) {
    const request = SkillLibraryImportParams.parse(input)
    if (request.hostId !== source.hostId) {
      throw new Error('skill-library-source-host-mismatch')
    }
    const candidates = await source.discover()
    const selected = [...new Set(request.candidateIds)].map((id) => {
      const candidate = candidates.find((row) => row.id === id)
      if (!candidate) {
        throw new Error('skill-library-candidate-not-found')
      }
      return candidate
    })
    const results: {
      candidateId: string
      status: 'imported' | 'unchanged' | 'conflict' | 'failed'
      version?: SkillLibraryVersion
      message?: string
    }[] = []
    for (const candidate of selected) {
      try {
        const value = await this.importOne(
          candidate,
          request.addVersion,
          source,
          request.expectedDigests?.find((row) => row.candidateId === candidate.id)?.packageDigest
        )
        results.push({ candidateId: candidate.id, ...value })
      } catch {
        results.push({
          candidateId: candidate.id,
          status: 'failed',
          message:
            'Skill import failed. The source may have changed, contain unsafe paths, or exceed package limits.'
        })
      }
    }
    return { results }
  }

  private async importOne(
    candidate: SkillLibraryCandidate,
    addVersion: boolean,
    source: SkillLibrarySource,
    expectedDigest?: string
  ) {
    return this.store.transact(async (catalog) => {
      const existing = catalog.versions.filter((version) => version.name === candidate.name)
      const packageId = existing[0]?.packageId ?? randomUUID()
      const versionId = randomUUID()
      await mkdir(join(this.store.root, 'staging'), { recursive: true, mode: 0o700 })
      const staging = await mkdtemp(join(this.store.root, 'staging', 'import-'))
      try {
        const created = await source.package(candidate.id, {
          packageId,
          versionId,
          archivePath: join(staging, 'package.tar.gz')
        })
        const verified = await extractSkillPackageArchive({
          archivePath: created.archivePath,
          destinationDirectory: join(staging, 'verified'),
          expectedArchiveSha256: created.archiveSha256,
          expectedPackageId: packageId,
          expectedVersionId: versionId,
          expectedPackageDigest: created.manifest.packageDigest
        })
        if (verified.manifest.name !== candidate.name) {
          throw new Error('skill-library-source-changed')
        }
        if (expectedDigest && verified.manifest.packageDigest !== expectedDigest) {
          throw new Error('skill-library-source-changed-since-review')
        }
        const origin = {
          hostId: source.hostId,
          candidateId: candidate.id,
          sourceLabel: candidate.sourceLabel,
          importedAt: new Date().toISOString()
        }
        const same = existing.find(
          (version) => version.packageDigest === verified.manifest.packageDigest
        )
        if (same) {
          if (
            !same.origins.some(
              (entry) => entry.hostId === origin.hostId && entry.candidateId === origin.candidateId
            )
          ) {
            if (same.origins.length >= 128) {
              throw new Error('skill-library-origin-limit')
            }
            same.origins.push(origin)
          }
          return { status: 'unchanged' as const, version: same }
        }
        if (existing.length > 0 && !addVersion) {
          return {
            status: 'conflict' as const,
            message:
              'A different skill with this name is already in the library. Review it before explicitly adding a version.'
          }
        }
        if (catalog.versions.length >= 2048) {
          throw new Error('skill-library-version-limit')
        }
        if ((await this.store.archiveBytes()) + created.compressedBytes > 256 * 1024 * 1024) {
          throw new Error('skill-library-storage-limit')
        }
        const version: SkillLibraryVersion = {
          packageId,
          versionId,
          packageDigest: verified.manifest.packageDigest,
          archiveSha256: created.archiveSha256,
          compressedBytes: created.compressedBytes,
          name: verified.manifest.name,
          description: verified.manifest.description,
          createdAt: verified.manifest.createdAt,
          files: verified.manifest.files.map(({ path, size, executable, classification }) => ({
            path,
            size,
            executable,
            classification
          })),
          origins: [origin]
        }
        await mkdir(join(this.store.root, 'archives'), { recursive: true, mode: 0o700 })
        await rename(created.archivePath, this.archivePath(versionId))
        catalog.versions.push(version)
        return { status: 'imported' as const, version }
      } finally {
        await rm(staging, { recursive: true, force: true })
      }
    })
  }
}
