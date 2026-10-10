import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  fixture,
  grant,
  repo,
  workspaceId,
  cleanupManagerFixtures
} from './manager-work.test-support'
import { managerUsageInventory } from '../../manager/manager-usage-inventory'
import type { MemorySnapshot } from '../../../../shared/process-stats-types'
import type { ExecutionAccountUsage } from '../../../../shared/execution-observer'

afterEach(cleanupManagerFixtures)

function account(): ExecutionAccountUsage {
  return {
    id: 'same-account',
    provider: 'codex',
    identityConfidence: 'account',
    accountKey: 'a'.repeat(64),
    sourceRef: 'private-source',
    credentialRevision: 'b'.repeat(64),
    sources: [
      {
        executionHostId: 'ssh:worker',
        label: 'Worker',
        sourceRef: 'private-worker-source',
        reachable: true
      },
      {
        executionHostId: 'ssh:other',
        label: 'Other',
        sourceRef: 'private-other-source',
        reachable: true
      }
    ],
    rateLimits: {
      provider: 'codex',
      session: { usedPercent: 20, windowMinutes: 300, resetsAt: 500, resetDescription: null },
      weekly: null,
      updatedAt: 1,
      error: null,
      status: 'ok',
      usageMetadata: { credentialSource: 'private-auth-path' }
    },
    checkedAt: 2,
    retryAt: 3
  }
}

function resourceSnapshot(): MemorySnapshot {
  const host = {
    totalMemory: 10_000,
    freeMemory: 1000,
    availableMemory: 4000,
    availableMemorySource: 'proc-meminfo' as const,
    usedMemory: 6000,
    memoryUsagePercent: 60,
    cpuCoreCount: 2,
    loadAverage1m: 1
  }
  const worktree = {
    worktreeId: workspaceId,
    repoId: repo.id,
    repoName: 'Project',
    worktreeName: 'main',
    cpu: 5,
    memory: 100,
    history: [],
    sessions: [{ sessionId: 'session', paneKey: 'pane', pid: 100, cpu: 5, memory: 100 }]
  }
  return {
    app: {
      cpu: 0,
      memory: 0,
      main: { cpu: 0, memory: 0 },
      renderer: { cpu: 0, memory: 0 },
      other: { cpu: 0, memory: 0 },
      history: []
    },
    host,
    worktrees: [],
    totalCpu: 0,
    totalMemory: 0,
    collectedAt: 123,
    processMemoryMetric: 'rss',
    hosts: [
      {
        id: 'ssh:worker',
        name: 'Worker',
        kind: 'ssh',
        connectionId: 'worker',
        host,
        managedCpu: 5,
        managedMemory: 100,
        worktrees: [worktree, { ...worktree, worktreeId: 'private::/private', repoId: 'private' }]
      },
      {
        id: 'ssh:other',
        name: 'Other',
        kind: 'ssh',
        connectionId: 'other',
        host,
        managedCpu: 0,
        managedMemory: 0,
        worktrees: []
      }
    ]
  }
}

describe('scoped manager placement inventory', () => {
  it('lists only granted known project locations with bounded pages', async () => {
    const f = fixture()
    vi.spyOn(f.runtime, 'listRepos').mockReturnValue([
      repo,
      { ...repo, id: 'private', path: '/private', connectionId: 'other' }
    ])
    const result = await f.call('manager.placements', {
      serviceToken: f.credential.token,
      limit: 1
    })
    expect(result).toMatchObject({
      ok: true,
      result: {
        items: [{ workspaceId, path: '/repo', executionHostId: 'ssh:worker' }],
        nextOffset: null
      }
    })
    expect(JSON.stringify(result)).not.toContain('/private')
    expect(
      (await f.call('manager.placements', { serviceToken: f.credential.token, limit: 201 })).ok
    ).toBe(false)
  })

  it('keeps deduplicated identities but strips ungranted sources, auth metadata and stale optimism', () => {
    const result = managerUsageInventory([account()], grant.scope, 400_000)
    expect(result).toMatchObject([
      {
        id: 'same-account',
        stale: true,
        sources: [{ executionHostId: 'ssh:worker' }],
        quotas: { session: { usedPercent: 20 } }
      }
    ])
    expect(JSON.stringify(result)).not.toContain('private')
    expect(JSON.stringify(result)).not.toContain('ssh:other')
    expect(result[0]).not.toHaveProperty('accountKey')
    expect(result[0]).not.toHaveProperty('credentialRevision')
    expect(
      managerUsageInventory([account()], { ...grant.scope, executionHostIds: ['local'] }, 1)
    ).toEqual([])
    expect(
      managerUsageInventory([{ ...account(), rateLimits: null }], grant.scope, 1)
    ).toMatchObject([{ stale: true, status: 'unavailable', quotas: null }])
  })

  it('requires usage authority even when project inventory is permitted', async () => {
    const f = fixture()
    expect(await f.call('manager.usage', { serviceToken: f.credential.token })).toMatchObject({
      ok: false,
      error: { code: 'manager_forbidden' }
    })
  })

  it('reuses resource samples while withholding other hosts and other projects sessions', async () => {
    const f = fixture()
    vi.spyOn(f.runtime, 'getMemorySnapshot').mockResolvedValue(resourceSnapshot())
    const result = await f.call('manager.resources', { serviceToken: f.credential.token })
    expect(result).toMatchObject({
      ok: true,
      result: {
        processMemoryMetric: 'rss',
        items: [
          {
            executionHostId: 'ssh:worker',
            collectedAt: 123,
            availability: 'observed',
            host: { availableMemory: 4000 },
            workspaces: [
              { workspaceId, memory: 100, sessions: [{ sessionId: 'session', memory: 100 }] }
            ]
          }
        ]
      }
    })
    expect(JSON.stringify(result)).not.toContain('private')
    expect(JSON.stringify(result)).not.toContain('ssh:other')
    if (!result.ok) {
      throw new Error('Resource lookup failed')
    }
    expect(
      z.object({ items: z.array(z.unknown()).length(1) }).parse(result.result).items
    ).toHaveLength(1)
  })

  it('rechecks revocation after resource collection and preserves unknown remote availability', async () => {
    const f = fixture()
    const snapshot = resourceSnapshot()
    const worker = snapshot.hosts?.[0]
    if (!worker) {
      throw new Error('Host fixture missing')
    }
    worker.host = null
    worker.worktrees = []
    worker.error = 'private failure information'
    vi.spyOn(f.runtime, 'getMemorySnapshot')
      .mockResolvedValueOnce(snapshot)
      .mockImplementationOnce(async () => {
        f.db.managerPrincipals.revoke(f.credential.principal.id)
        return snapshot
      })
    expect(await f.call('manager.resources', { serviceToken: f.credential.token })).toMatchObject({
      ok: true,
      result: { items: [{ availability: 'unverifiable', host: null, workspaces: [] }] }
    })
    expect(await f.call('manager.resources', { serviceToken: f.credential.token })).toMatchObject({
      ok: false,
      error: { code: 'manager_unauthorized' }
    })
  })
})
