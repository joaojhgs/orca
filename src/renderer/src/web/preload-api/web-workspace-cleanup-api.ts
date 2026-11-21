import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import {
  WorkspaceCleanupControlParams,
  type WorkspaceCleanupControlRequest
} from '../../../../shared/rpc-contract/workspace-cleanup-params'
import type { WorkspaceCleanupApi } from '../../../../preload/api/workspaces/workspace-cleanup-api'
import type {
  WorkspaceCleanupScanProgress,
  WorkspaceCleanupScanResult
} from '../../../../shared/workspace-cleanup/workspace-cleanup'
import { callEnvironmentEnvelope } from '../runtime/client/web-runtime-calls'
import { requireActiveEnvironment } from '../runtime/client/web-runtime-session'
import { createNonSecureContextUuid as createBrowserUuid } from '../../../../shared/identifiers/non-secure-context-uuid'

export function createWebWorkspaceCleanupApi(): WorkspaceCleanupApi {
  const scanOwners = new Map<string, string>()
  async function call<T>(
    environmentId: string,
    request: WorkspaceCleanupControlRequest
  ): Promise<T> {
    const response = await callEnvironmentEnvelope<T>(
      environmentId,
      'workspaceCleanup.control',
      request,
      10 * 60_000
    )
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    return response.result
  }
  const control = <T>(request: WorkspaceCleanupControlRequest): Promise<T> =>
    call(requireActiveEnvironment().id, request)
  return {
    scan: async (args, onProgress) => {
      const environmentId = requireActiveEnvironment().id
      const scanId = args?.scanId ?? createBrowserUuid()
      scanOwners.set(scanId, environmentId)
      let finished = false
      let polling = false
      const stopProgressPolling = onProgress
        ? installWindowVisibilityInterval({
            intervalMs: 1000,
            runOnVisible: () => {},
            run: () => {
              if (polling || finished) {
                return
              }
              polling = true
              void call<WorkspaceCleanupScanProgress | null>(environmentId, {
                operation: 'getProgress',
                scanId
              })
                .then((progress) => {
                  if (progress && !finished) {
                    onProgress(progress)
                  }
                })
                // Progress is advisory; the final scan request owns success or failure.
                .catch(() => {})
                .finally(() => {
                  polling = false
                })
            }
          })
        : undefined
      try {
        const result = await call<WorkspaceCleanupScanResult>(environmentId, {
          operation: 'scan',
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
        stopProgressPolling?.()
        if (scanOwners.get(scanId) === environmentId) {
          scanOwners.delete(scanId)
        }
      }
    },
    cancelScan: (scanId) =>
      call(scanOwners.get(scanId) ?? requireActiveEnvironment().id, {
        operation: 'cancelScan',
        scanId
      }),
    getCachedScan: () => control({ operation: 'getCachedScan' }),
    dismiss: (args) => control(WorkspaceCleanupControlParams.parse({ operation: 'dismiss', args })),
    clearDismissals: () => control({ operation: 'clearDismissals' }),
    beginRemovalSnapshotPruneBatch: (args) =>
      control({ operation: 'beginRemovalSnapshotPruneBatch', args }),
    recordRemovalSnapshotPrune: (args) =>
      control({ operation: 'recordRemovalSnapshotPrune', args }),
    finishRemovalSnapshotPruneBatch: (args) =>
      control({ operation: 'finishRemovalSnapshotPruneBatch', args }),
    onRunFinished: () => () => {}
  }
}
