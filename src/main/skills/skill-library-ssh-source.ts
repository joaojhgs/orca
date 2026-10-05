import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { SkillLibraryCandidateSchema } from '../../shared/skill-library-contract'
import { SkillPackageManifestV1Schema } from '../../shared/skill-package-manifest'
import { SkillPackageIdentitySchema } from '../../shared/skill-install-contract'
import type { SkillLibrarySource } from './skill-library-service'
import { executionObserverClient } from '../execution-observer/observer-client'
import type { SshConnection } from '../ssh/ssh-connection'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { toSshExecutionHostId } from '../../shared/execution-host'

const PackageExportSchema = z.object({
  manifest: SkillPackageManifestV1Schema,
  archivePath: z.string().min(1),
  archiveSha256: SkillPackageIdentitySchema.shape.archiveSha256,
  compressedBytes: SkillPackageIdentitySchema.shape.compressedBytes
})

export function sshSkillLibrarySource(connection: SshConnection): SkillLibrarySource {
  const connectionId = connection.getTarget().id
  return {
    hostId: toSshExecutionHostId(connectionId),
    discover: async () =>
      z
        .array(SkillLibraryCandidateSchema)
        .max(2000)
        .parse(
          await executionObserverClient.observe({ operation: 'library-discover' }, connection)
        ),
    package: async (candidateId, input) => {
      const generation = connection.getState().connectionGeneration
      const provider = getSshFilesystemProvider(connectionId)
      if (!provider?.downloadFile) {
        throw new Error('skill-library-ssh-download-unavailable')
      }
      const exportId = randomUUID()
      try {
        const exported = PackageExportSchema.parse(
          await executionObserverClient.observe(
            {
              operation: 'library-package',
              candidateId,
              packageId: input.packageId,
              versionId: input.versionId,
              exportId
            },
            connection
          )
        )
        const before = await provider.stat(exported.archivePath)
        if (before.type !== 'file' || before.size !== exported.compressedBytes) {
          throw new Error('skill-library-export-size-mismatch')
        }
        await provider.downloadFile(exported.archivePath, input.archivePath)
        if (
          getSshFilesystemProvider(connectionId) !== provider ||
          connection.getState().status !== 'connected' ||
          connection.getState().connectionGeneration !== generation
        ) {
          throw new Error('skill-library-export-unverifiable')
        }
        return { ...exported, archivePath: input.archivePath }
      } finally {
        await executionObserverClient
          .observe({ operation: 'library-cleanup', exportId }, connection)
          .catch(() => undefined)
      }
    }
  }
}
