import type { MemorySnapshot } from '../../../../../shared/diagnostics/process-stats-types'
import { callRuntimeResultWithOwner } from '../../runtime/client/web-runtime-calls'
import type { PreloadApi } from '../../../../../preload/api-types'

export function createWebMemoryApi(): PreloadApi['memory'] {
  return {
    getSnapshot: async () => {
      const { result, environmentId } =
        await callRuntimeResultWithOwner<MemorySnapshot>('diagnostics.memory')
      const localHost = result.hosts?.find((host) => host.kind === 'local')
      return {
        ...result,
        runtimeOwnerEnvironmentId: environmentId,
        ...(localHost
          ? {
              worktrees: result.worktrees.map((worktree) => ({
                ...worktree,
                executionHostId: 'local',
                executionHostName: localHost.name
              }))
            }
          : {})
      }
    },
    readPerfNoticeSignals: () => Promise.resolve(null),
    countHiddenBrowserPages: () => Promise.resolve(0),
    resourceWindowVisible: () => Promise.resolve(true),
    onResourceWindowVisibility: () => () => {}
  }
}
