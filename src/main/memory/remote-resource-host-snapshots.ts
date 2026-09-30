import os from 'node:os'
import type {
  ResourceHostSnapshot,
  HostMemory,
  WorktreeMemory,
  UsageValues
} from '../../shared/process-stats-types'
import { ORPHAN_WORKTREE_ID } from '../../shared/constants'
import { listRemoteResourceProviders } from './remote-resource-provider-registry'
import { resolveWorktreeMemoryNames, type MemorySnapshotStore } from './memory-snapshot-buckets'

export async function collectResourceHosts(
  store: MemorySnapshotStore,
  host: HostMemory,
  worktrees: WorktreeMemory[],
  app: UsageValues
): Promise<ResourceHostSnapshot[]> {
  return [
    {
      id: 'local',
      name: os.hostname(),
      kind: 'local',
      connectionId: null,
      host,
      worktrees,
      managedCpu: app.cpu + worktrees.reduce((sum, worktree) => sum + worktree.cpu, 0),
      managedMemory: app.memory + worktrees.reduce((sum, worktree) => sum + worktree.memory, 0)
    },
    ...(await collectRemoteResourceHosts(store))
  ]
}

export function collectRemoteResourceHosts(
  store: MemorySnapshotStore
): Promise<ResourceHostSnapshot[]> {
  return Promise.all(
    listRemoteResourceProviders().map(async ({ connectionId, name, collect }) => {
      const identity = { id: `ssh:${connectionId}`, name, kind: 'ssh' as const, connectionId }
      try {
        const remote = await collect()
        const worktrees = remote.worktrees.map(({ worktreeId, sessions }) => {
          const resolvedId = worktreeId ?? ORPHAN_WORKTREE_ID
          return {
            ...resolveWorktreeMemoryNames(resolvedId, store),
            worktreeId: resolvedId,
            sessions,
            cpu: sessions.reduce((sum, session) => sum + session.cpu, 0),
            memory: sessions.reduce((sum, session) => sum + session.memory, 0),
            history: []
          }
        })
        return {
          ...identity,
          host: remote.host,
          worktrees,
          managedCpu: worktrees.reduce((sum, worktree) => sum + worktree.cpu, 0),
          managedMemory: worktrees.reduce((sum, worktree) => sum + worktree.memory, 0)
        }
      } catch (error) {
        return {
          ...identity,
          host: null,
          worktrees: [],
          managedCpu: 0,
          managedMemory: 0,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    })
  )
}
