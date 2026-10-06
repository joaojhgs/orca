import type { Store } from '../persistence'
import type { WorkspaceCleanupControlRequest } from '../../shared/rpc-contract/workspace-cleanup-params'
import type { WorkspaceCleanupScanProgress } from '../../shared/workspace-cleanup'
import { parseExecutionHostId } from '../../shared/execution-host'
import { getWorkspaceCleanupHostIdentity } from '../../shared/workspace-cleanup-host-identity'
import { scanWorkspaceCleanup } from '../ipc/workspace-cleanup-scan'
import { hasTargetedWorkspaceCleanupScan } from '../ipc/workspace-cleanup-scan-targets'
import { throwIfWorkspaceCleanupScanAborted } from '../ipc/workspace-cleanup-scan-primitives'
import {
  persistWorkspaceCleanupScanResult,
  readWorkspaceCleanupScanSnapshot
} from '../workspace-cleanup-scan-snapshot'
import {
  beginWorkspaceCleanupRemovalSnapshotPruneBatch,
  recordWorkspaceCleanupRemovalSnapshotPrune,
  finishWorkspaceCleanupRemovalSnapshotPruneBatch
} from '../workspace-cleanup-removal-snapshot-prune'

/** A paired device can cancel only its own scans, never another browser's work. */
export class RuntimeWorkspaceCleanup {
  private scans = new Map<string, AbortController>()
  private lanes = new Map<string, AbortController>()
  private progress = new Map<string, WorkspaceCleanupScanProgress>()

  constructor(private store: Store) {}

  async control(
    request: WorkspaceCleanupControlRequest,
    owner: string,
    signal?: AbortSignal
  ): Promise<unknown> {
    const directory = this.store.getProfileStorageDirectory()
    switch (request.operation) {
      case 'scan': {
        const args = request.args ?? {}
        const key = `${owner}\0${args.scanId ?? crypto.randomUUID()}`
        const lane = `${owner}\0${args.includeAllWorkspaces === true}`
        const targeted = hasTargetedWorkspaceCleanupScan(args)
        const controller = new AbortController()
        this.scans.get(key)?.abort()
        this.scans.set(key, controller)
        this.progress.delete(key)
        if (!targeted) {
          this.lanes.get(lane)?.abort()
          this.lanes.set(lane, controller)
        }
        const abort = (): void => controller.abort()
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) {
          controller.abort()
        }
        try {
          const result = await scanWorkspaceCleanup(this.store, args, {
            signal: controller.signal,
            onProgress: (progress) => {
              if (this.scans.get(key) !== controller) {
                return
              }
              const previous = this.progress.get(key)
              this.progress.set(key, {
                ...progress,
                candidateMode: 'snapshot',
                candidates:
                  progress.candidateMode === 'append'
                    ? [...(previous?.candidates ?? []), ...progress.candidates]
                    : progress.candidates
              })
            }
          })
          throwIfWorkspaceCleanupScanAborted(controller.signal)
          if (!targeted) {
            await persistWorkspaceCleanupScanResult(directory, args, result)
          }
          return result
        } finally {
          signal?.removeEventListener('abort', abort)
          if (this.scans.get(key) === controller) {
            this.scans.delete(key)
            this.progress.delete(key)
          }
          if (this.lanes.get(lane) === controller) {
            this.lanes.delete(lane)
          }
        }
      }
      case 'cancelScan': {
        const controller = this.scans.get(`${owner}\0${request.scanId}`)
        if (!controller || controller.signal.aborted) {
          return false
        }
        controller.abort()
        return true
      }
      case 'getProgress':
        return this.progress.get(`${owner}\0${request.scanId}`) ?? null
      case 'getCachedScan':
        return readWorkspaceCleanupScanSnapshot(directory)
      case 'clearDismissals':
        this.store.updateUI({ workspaceCleanup: { dismissals: {} } })
        return null
      case 'dismiss': {
        const next = { ...this.store.getUI().workspaceCleanup?.dismissals }
        for (const [identity, dismissal] of Object.entries(next)) {
          if (request.args.removedWorktreeIds?.includes(dismissal.worktreeId)) {
            delete next[identity]
          }
        }
        for (const dismissal of request.args.dismissals) {
          const host = dismissal.executionHostId
          if (host !== undefined && !parseExecutionHostId(host)) {
            throw new Error('invalid_execution_host')
          }
          next[
            host
              ? getWorkspaceCleanupHostIdentity(host, dismissal.worktreeId)
              : dismissal.worktreeId
          ] = dismissal
        }
        this.store.updateUI({ workspaceCleanup: { dismissals: next } })
        return null
      }
      // Prune batches own only their device's snapshot bookkeeping, not another client's batch.
      case 'beginRemovalSnapshotPruneBatch':
        beginWorkspaceCleanupRemovalSnapshotPruneBatch(directory, {
          batchId: `${owner}\0${request.args.batchId}`
        })
        return null
      case 'recordRemovalSnapshotPrune':
        if (request.args.executionHostId && !parseExecutionHostId(request.args.executionHostId)) {
          throw new Error('invalid_execution_host')
        }
        recordWorkspaceCleanupRemovalSnapshotPrune(directory, {
          ...request.args,
          batchId: `${owner}\0${request.args.batchId}`
        })
        return null
      case 'finishRemovalSnapshotPruneBatch':
        await finishWorkspaceCleanupRemovalSnapshotPruneBatch(directory, {
          batchId: `${owner}\0${request.args.batchId}`
        })
        return null
    }
  }
}
