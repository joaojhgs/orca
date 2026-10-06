import type { MemorySnapshot } from '../../../../shared/process-stats-types'
import { callRuntimeResultWithOwner } from './web-runtime-calls'
import type { PreloadApi } from '../../../../preload/api-types'

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
    }
  }
}
