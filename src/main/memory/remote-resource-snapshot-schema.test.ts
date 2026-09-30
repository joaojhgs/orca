import { describe, expect, it } from 'vitest'
import { remoteResourceSnapshotSchema } from './remote-resource-snapshot-schema'

const snapshot = {
  host: {
    totalMemory: 100,
    freeMemory: 10,
    availableMemory: 20,
    availableMemorySource: 'proc-meminfo',
    usedMemory: 80,
    memoryUsagePercent: 80,
    cpuCoreCount: 4,
    loadAverage1m: 0
  },
  worktrees: [
    {
      worktreeId: 'worktree-1',
      sessions: [{ sessionId: 'resource:pane-1', paneKey: 'pane-1', pid: 123, cpu: 10, memory: 5 }]
    }
  ]
}

describe('remote resource snapshot validation', () => {
  it('accepts older hosts without optional CPU and disk fields', () => {
    expect(remoteResourceSnapshotSchema.parse(snapshot)).toEqual(snapshot)
  })

  it('rejects malformed host or process data instead of reporting healthy zero usage', () => {
    expect(() => remoteResourceSnapshotSchema.parse({ ...snapshot, host: null })).toThrow()
    expect(() =>
      remoteResourceSnapshotSchema.parse({
        ...snapshot,
        worktrees: [{ worktreeId: 'worktree-1', sessions: [{ pid: 'bad' }] }]
      })
    ).toThrow()
  })
})
