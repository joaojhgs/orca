import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SshConnection } from '../ssh/ssh-connection'
import { executionObserverClient } from '../execution-observer/observer-client'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { SkillInstallResultSchema } from '../../shared/skill-install-contract'
import type { SkillLibraryWorkerRequest } from '../../shared/skill-library-worker-contract'
import {
  SkillLibraryUnavailableError,
  type SkillLibraryPlacement
} from './skill-library-assignments'

type WorkerDestination = Extract<
  SkillLibraryWorkerRequest,
  { operation: 'library-install' }
>['destination']

export function sshSkillLibraryPlacement(
  connection: SshConnection,
  destination: WorkerDestination
): SkillLibraryPlacement {
  return {
    install: async (version, archivePath, assignment) => {
      const connectionId = connection.getTarget().id
      const generation = connection.getState().connectionGeneration
      const provider = getSshFilesystemProvider(connectionId)
      if (!provider?.openFileUploadSession) {
        throw new SkillLibraryUnavailableError('skill-library-ssh-upload-unavailable')
      }
      const exportId = randomUUID()
      try {
        const staged = z
          .object({ archivePath: z.string().min(1) })
          .parse(
            await executionObserverClient.observe(
              { operation: 'library-stage', exportId },
              connection
            )
          )
        const upload = await provider.openFileUploadSession()
        try {
          await upload.uploadFile(archivePath, staged.archivePath, { exclusive: true })
        } finally {
          await upload.close()
        }
        if (
          connection.getState().connectionGeneration !== generation ||
          getSshFilesystemProvider(connectionId) !== provider ||
          connection.getState().status !== 'connected'
        ) {
          throw new SkillLibraryUnavailableError('skill-library-ssh-generation-changed')
        }
        return SkillInstallResultSchema.parse(
          await executionObserverClient.observe(
            {
              operation: 'library-install',
              exportId,
              version,
              providers: assignment.providers,
              destination
            },
            connection
          )
        )
      } finally {
        await executionObserverClient
          .observe({ operation: 'library-cleanup', exportId }, connection)
          .catch(() => undefined)
      }
    },
    remove: async (version, assignment) =>
      SkillInstallResultSchema.parse(
        await executionObserverClient.observe(
          { operation: 'library-remove', version, providers: assignment.providers, destination },
          connection
        )
      )
  }
}
