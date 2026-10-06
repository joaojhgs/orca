import type { WorkspaceCleanupApi } from '../../../../preload/api/workspace-cleanup-api'
import type {
  WorkspaceCleanupScanProgress,
  WorkspaceCleanupScanResult
} from '../../../../shared/workspace-cleanup'
import { callEnvironmentEnvelope } from './web-runtime-calls'
import { requireActiveEnvironment } from './web-runtime-session'
import { createBrowserUuid } from '@/lib/browser-uuid'

export function createWebWorkspaceCleanupApi(): WorkspaceCleanupApi {
  const scanOwners = new Map<string, string>()
  async function call<T>(
    environmentId: string,
    operation: string,
    params: object = {}
  ): Promise<T> {
    const response = await callEnvironmentEnvelope<T>(
      environmentId,
      'workspaceCleanup.control',
      { operation, ...params },
      10 * 60_000
    )
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    return response.result
  }
  const control = <T>(operation: string, params?: object): Promise<T> =>
    call(requireActiveEnvironment().id, operation, params)
  return {
    scan: async (args, onProgress) => {
      const environmentId = requireActiveEnvironment().id
      const scanId = args?.scanId ?? createBrowserUuid()
      scanOwners.set(scanId, environmentId)
      let finished = false
      let polling = false
      const timer = onProgress
        ? setInterval(() => {
            if (polling || finished) {
              return
            }
            polling = true
            void call<WorkspaceCleanupScanProgress | null>(environmentId, 'getProgress', { scanId })
              .then((progress) => {
                if (progress && !finished) {
                  onProgress(progress)
                }
              })
              // Progress is advisory; the final scan request owns success/failure.
              .catch(() => {})
              .finally(() => {
                polling = false
              })
          }, 1000)
        : undefined
      try {
        const result = await call<WorkspaceCleanupScanResult>(environmentId, 'scan', {
          args: { ...args, scanId }
        })
        if (!result || !Array.isArray(result.candidates) || !Array.isArray(result.errors)) {
          throw new Error(
            'The server returned an invalid workspace cleanup scan. Update the server and refresh.'
          )
        }
        return result
      } finally {
        finished = true
        clearInterval(timer)
        if (scanOwners.get(scanId) === environmentId) {
          scanOwners.delete(scanId)
        }
      }
    },
    cancelScan: (scanId) =>
      call(scanOwners.get(scanId) ?? requireActiveEnvironment().id, 'cancelScan', { scanId }),
    getCachedScan: () => control('getCachedScan'),
    dismiss: (args) => control('dismiss', { args }),
    clearDismissals: () => control('clearDismissals'),
    beginRemovalSnapshotPruneBatch: (args) => control('beginRemovalSnapshotPruneBatch', { args }),
    recordRemovalSnapshotPrune: (args) => control('recordRemovalSnapshotPrune', { args }),
    finishRemovalSnapshotPruneBatch: (args) => control('finishRemovalSnapshotPruneBatch', { args })
  }
}
