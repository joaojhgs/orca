import { afterEach, describe, expect, it } from 'vitest'
import type { HostMemory } from '../../shared/process-stats-types'
import type { MemorySnapshotStore } from './memory-snapshot-buckets'
import { collectResourceHosts } from './remote-resource-host-snapshots'
import {
  listRemoteResourceProviders,
  registerRemoteResourceProvider,
  unregisterRemoteResourceProvider
} from './remote-resource-provider-registry'

const host: HostMemory = {
  totalMemory: 1000,
  freeMemory: 300,
  availableMemory: 400,
  availableMemorySource: 'proc-meminfo',
  usedMemory: 600,
  memoryUsagePercent: 60,
  cpuCoreCount: 2,
  loadAverage1m: 0
}
const store = {
  getRepo: () => undefined,
  getWorktreeMeta: () => undefined,
  getFolderWorkspace: () => undefined,
  getProjectGroups: () => []
} satisfies MemorySnapshotStore
afterEach(() => {
  for (const provider of listRemoteResourceProviders()) {
    unregisterRemoteResourceProvider(provider.connectionId)
  }
})
describe('resource host snapshots', () => {
  it('retains local metrics while collecting SSH host-owned samples', async () => {
    registerRemoteResourceProvider('personal', {
      name: 'Personal',
      collect: async () => ({
        host,
        worktrees: [
          {
            worktreeId: 'repo::/workspace',
            sessions: [
              { sessionId: 'ssh:personal@@terminal', paneKey: null, pid: 123, cpu: 5, memory: 100 }
            ]
          }
        ]
      })
    })
    const snapshots = await collectResourceHosts(store, host, [], { cpu: 1, memory: 10 })
    expect(snapshots[0]).toMatchObject({ kind: 'local', managedCpu: 1, managedMemory: 10 })
    expect(snapshots[1]).toMatchObject({
      id: 'ssh:personal',
      name: 'Personal',
      managedCpu: 5,
      managedMemory: 100,
      host,
      worktrees: [
        {
          repoId: 'repo',
          worktreeName: 'workspace',
          sessions: [{ sessionId: 'ssh:personal@@terminal' }]
        }
      ]
    })
  })
  it('reports unreachable hosts as unavailable instead of zero-memory healthy hosts', async () => {
    registerRemoteResourceProvider('personal', {
      name: 'Personal',
      collect: async () => {
        throw new Error('Disconnected')
      }
    })
    const snapshots = await collectResourceHosts(store, host, [], { cpu: 0, memory: 0 })
    expect(snapshots[1]).toMatchObject({ host: null, worktrees: [], error: 'Disconnected' })
  })
})
