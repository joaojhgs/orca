import type { MemorySnapshot } from '../../../../shared/process-stats-types'

// Keep host-specific commit pressure separate from the cross-host presentation totals.
export function withRemoteResourceSamples(snapshot: MemorySnapshot | null): MemorySnapshot | null {
  if (!snapshot) {
    return null
  }
  const remote = snapshot.hosts?.filter((host) => host.kind === 'ssh' && host.host !== null) ?? []
  if (remote.length === 0) {
    return snapshot
  }
  const {
    processCommitMetric: _commitMetric,
    totalPrivateMemory: _privateMemory,
    ...local
  } = snapshot
  return {
    ...local,
    worktrees: [...snapshot.worktrees, ...remote.flatMap((host) => host.worktrees)],
    totalCpu: snapshot.totalCpu + remote.reduce((sum, host) => sum + host.managedCpu, 0),
    totalMemory: snapshot.totalMemory + remote.reduce((sum, host) => sum + host.managedMemory, 0)
  }
}
