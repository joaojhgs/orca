import { describe, expect, it, vi } from 'vitest'
import {
  ExecutionAccountUsageService,
  type UsageExecutionHost
} from './execution-account-usage-service'
import type { ExecutionCredential } from '../../shared/execution-observer'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'

const account: ExecutionCredential = {
  provider: 'codex',
  sourceRef: 'codex:default',
  accountKey: 'a'.repeat(64),
  identityConfidence: 'account'
}
const quota: ProviderRateLimits = {
  provider: 'codex',
  session: null,
  weekly: { usedPercent: 25, windowMinutes: 10080, resetsAt: null, resetDescription: null },
  updatedAt: 100000,
  status: 'ok',
  error: null
}
function host(id: string, credentials: ExecutionCredential[] = [account]): UsageExecutionHost {
  return {
    id,
    label: id,
    generation: 1,
    reachable: true,
    discover: vi.fn().mockResolvedValue(credentials),
    collect: vi.fn().mockResolvedValue(quota)
  }
}

describe('ExecutionAccountUsageService', () => {
  it('deduplicates matching accounts across hosts and collects quota once', async () => {
    const local = host('local', [{ ...account, credentialRevision: '1'.repeat(64) }]),
      ssh = host('ssh:personal', [{ ...account, credentialRevision: '2'.repeat(64) }])
    const service = new ExecutionAccountUsageService(() => [local, ssh], vi.fn())
    await Promise.all([service.refresh(), service.refresh()])
    expect(service.getState()).toHaveLength(1)
    expect(service.getState()[0]?.sources.map((source) => source.executionHostId)).toEqual([
      'local',
      'ssh:personal'
    ])
    expect(local.collect).toHaveBeenCalledTimes(1)
    expect(ssh.collect).not.toHaveBeenCalled()
    expect(service.getState()[0]?.sources.map((source) => source.credentialRevision)).toEqual([
      '1'.repeat(64),
      '2'.repeat(64)
    ])
  })

  it('keeps different accounts and providers separate but groups identical OpenCode credentials', async () => {
    const unknown: ExecutionCredential = {
      provider: 'opencode',
      providerId: 'opencode-go',
      sourceRef: 'opencode:opencode-go',
      accountKey: null,
      identityConfidence: 'unknown',
      credentialRevision: 'b'.repeat(64)
    }
    const hosts = [
      host('local', [account, unknown]),
      host('ssh:personal', [
        { ...account, accountKey: 'c'.repeat(64) },
        { ...account, provider: 'claude' },
        unknown
      ])
    ]
    const service = new ExecutionAccountUsageService(() => hosts, vi.fn())
    await service.refresh()
    expect(service.getState()).toHaveLength(4)
    const shared = service.getState().find((row) => row.provider === 'opencode')
    expect(shared?.identityConfidence).toBe('unknown')
    expect(shared?.sources).toHaveLength(2)
  })

  it('does not merge different OpenCode keys or equal digests belonging to different providers', async () => {
    const key: ExecutionCredential = {
      provider: 'opencode',
      providerId: 'zai-coding-plan',
      sourceRef: 'opencode:zai-coding-plan',
      accountKey: null,
      identityConfidence: 'unknown',
      credentialRevision: 'b'.repeat(64)
    }
    const owners = [
      host('local', [key]),
      host('ssh:personal', [
        { ...key, credentialRevision: 'c'.repeat(64) },
        { ...key, providerId: 'openrouter', sourceRef: 'opencode:openrouter' }
      ])
    ]
    const service = new ExecutionAccountUsageService(() => owners, vi.fn())
    await service.refresh()
    expect(service.getState()).toHaveLength(3)
  })

  it('retains a verified identity across a failed lookup only while the credential is unchanged', async () => {
    let now = 100000
    const known: ExecutionCredential = {
      ...account,
      provider: 'opencode',
      providerId: 'github-copilot',
      sourceRef: 'opencode:github-copilot',
      credentialRevision: 'c'.repeat(64)
    }
    const owner = host('local', [known])
    const service = new ExecutionAccountUsageService(
      () => [owner],
      vi.fn(),
      () => now
    )
    await service.refresh()
    owner.discover = vi
      .fn()
      .mockResolvedValue([{ ...known, accountKey: null, identityConfidence: 'unknown' }])
    now += 30001
    await service.refresh()
    expect(service.getState()[0]?.accountKey).toBe(known.accountKey)
    owner.discover = vi.fn().mockResolvedValue([
      {
        ...known,
        credentialRevision: 'd'.repeat(64),
        accountKey: null,
        identityConfidence: 'unknown'
      }
    ])
    now += 30001
    await service.refresh()
    expect(service.getState()[0]?.accountKey).toBeNull()
  })

  it('uses a fresh credential for the same account and remembers its owner without bypassing backoff', async () => {
    let now = 100000
    const local = host('local'),
      ssh = host('ssh:personal')
    local.collect = vi.fn().mockResolvedValue({
      ...quota,
      status: 'error',
      usageMetadata: { failureKind: 'stale-token' }
    })
    const service = new ExecutionAccountUsageService(
      () => [local, ssh],
      vi.fn(),
      () => now
    )
    await service.refresh()
    expect(service.getState()).toHaveLength(1)
    expect(service.getState()[0]?.rateLimits).toEqual(quota)
    expect(local.collect).toHaveBeenCalledTimes(1)
    expect(ssh.collect).toHaveBeenCalledTimes(1)
    now += 300001
    await service.refresh()
    expect(local.collect).toHaveBeenCalledTimes(1)
    expect(ssh.collect).toHaveBeenCalledTimes(2)
  })

  it('honors Retry-After across refreshes and hosts, including repeated manual reads', async () => {
    let now = 100000
    const owner = host('local')
    owner.collect = vi.fn().mockResolvedValue({
      ...quota,
      status: 'error',
      error: 'Usage is rate limited',
      usageMetadata: { failureKind: 'rate-limited', retryAtMs: 100000 + 3600000 }
    })
    const service = new ExecutionAccountUsageService(
      () => [owner, host('ssh:personal')],
      vi.fn(),
      () => now
    )
    await service.refresh()
    now += 300000
    await service.refresh()
    now += 300000
    await service.refresh()
    expect(owner.collect).toHaveBeenCalledTimes(1)
    now = 100000 + 3600001
    await service.refresh()
    expect(owner.collect).toHaveBeenCalledTimes(2)
  })

  it('preserves an unreachable host as unverifiable, without polling a local substitute', async () => {
    let now = 100000
    const ssh = host('ssh:personal')
    const service = new ExecutionAccountUsageService(
      () => [ssh],
      vi.fn(),
      () => now
    )
    await service.refresh()
    ssh.reachable = false
    now += 300001
    await service.refresh()
    expect(service.getState()[0]).toMatchObject({
      error: expect.stringContaining('unverifiable'),
      sources: [{ reachable: false }],
      rateLimits: quota
    })
    expect(ssh.collect).toHaveBeenCalledTimes(1)
  })

  it('clears removed accounts and never reuses an unknown credential or target incarnation cache', async () => {
    let now = 100000
    const credential: ExecutionCredential = {
      ...account,
      accountKey: null,
      identityConfidence: 'unknown',
      credentialRevision: 'd'.repeat(64)
    }
    const owner = host('ssh:personal', [credential])
    const service = new ExecutionAccountUsageService(
      () => [owner],
      vi.fn(),
      () => now
    )
    await service.refresh()
    const firstId = service.getState()[0]?.id
    owner.discover = vi
      .fn()
      .mockResolvedValue([{ ...credential, credentialRevision: 'e'.repeat(64) }])
    now += 30001
    await service.refresh()
    expect(service.getState()[0]?.id).not.toEqual(firstId)
    expect(owner.collect).toHaveBeenCalledTimes(2)
    owner.generation += 1
    owner.reachable = false
    now += 30001
    await service.refresh()
    expect(service.getState()).toEqual([])
  })

  it('does not publish results from a stopped collector', async () => {
    let resolve: (value: ProviderRateLimits) => void = () => {}
    const owner = host('local')
    owner.collect = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const changed = vi.fn()
    const service = new ExecutionAccountUsageService(() => [owner], changed)
    const refresh = service.refresh()
    await vi.waitFor(() => expect(owner.collect).toHaveBeenCalledTimes(1))
    service.stop()
    resolve(quota)
    await refresh
    expect(changed).not.toHaveBeenCalled()
  })
})
