import { describe, expect, it } from 'vitest'
import type { MemorySnapshot } from '../../../../shared/process-stats-types'
import { withRemoteResourceSamples } from './remote-resource-samples'

function snapshot(): MemorySnapshot {
  return {
    app: {
      cpu: 1,
      memory: 100,
      main: { cpu: 1, memory: 100 },
      renderer: { cpu: 0, memory: 0 },
      other: { cpu: 0, memory: 0 },
      history: []
    },
    worktrees: [],
    host: {
      totalMemory: 1000,
      freeMemory: 500,
      availableMemory: 500,
      availableMemorySource: 'free-memory',
      usedMemory: 500,
      memoryUsagePercent: 50,
      cpuCoreCount: 2,
      loadAverage1m: 0
    },
    processMemoryMetric: 'working-set',
    processCommitMetric: 'private-bytes',
    totalPrivateMemory: 200,
    totalMemory: 100,
    totalCpu: 1,
    collectedAt: 0
  }
}
describe('remote resource presentation', () => {
  it('keeps legacy/local-only snapshots and commit metrics unchanged', () => {
    expect(withRemoteResourceSamples(null)).toBeNull()
    const local = snapshot()
    expect(withRemoteResourceSamples(local)).toBe(local)
  })
  it('adds SSH samples without misrepresenting local commit as a cross-host total', () => {
    const local = snapshot()
    const worktree = {
      worktreeId: 'repo::/workspace',
      worktreeName: 'workspace',
      repoId: 'repo',
      repoName: 'Repo',
      cpu: 2,
      memory: 300,
      sessions: [],
      history: []
    }
    local.hosts = [
      {
        id: 'ssh:personal',
        connectionId: 'personal',
        name: 'Personal',
        kind: 'ssh',
        host: local.host,
        worktrees: [worktree],
        managedCpu: 2,
        managedMemory: 300
      }
    ]
    const combined = withRemoteResourceSamples(local)
    expect(combined).toMatchObject({ totalCpu: 3, totalMemory: 400, worktrees: [worktree] })
    expect(combined).not.toHaveProperty('totalPrivateMemory')
    expect(combined).not.toHaveProperty('processCommitMetric')
    expect(local.totalMemory).toBe(100)
    expect(local.totalPrivateMemory).toBe(200)
  })
})
