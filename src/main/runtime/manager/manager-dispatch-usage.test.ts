import { describe, expect, it } from 'vitest'
import { ManagerDispatchPolicySchema } from '../../../shared/manager-dispatch-capacity-contract'
import { selectManagerDispatchAccount } from './manager-dispatch-usage'
import { dispatchAccount } from './manager-dispatch.test-fixture'

const now = 1000_000,
  policy = ManagerDispatchPolicySchema.parse({})
const target = { executionHostId: 'ssh:worker', agent: 'codex' }

describe('manager fresh account dispatch gate', () => {
  it('uses a shared deduplicated identity and does not mistake normal future refresh scheduling for exhaustion', () => {
    const account = dispatchAccount(now)
    expect(selectManagerDispatchAccount([account], target, policy, now).id).toBe(account.id)
    expect(
      selectManagerDispatchAccount(
        [account],
        { ...target, executionHostId: 'ssh:second' },
        policy,
        now
      ).id
    ).toBe(account.id)
  })

  it.each([
    'missing',
    'ambiguous',
    'unreachable',
    'stale',
    'future',
    'error',
    'empty',
    'exhausted',
    'retry-after',
    'invalid'
  ] as const)('refuses %s quota rather than assuming free capacity', (mode) => {
    const account = dispatchAccount(now)
    const limits = account.rateLimits
    if (!limits?.weekly) {
      throw new Error('Missing fixture limits')
    }
    let rows = [account]
    if (mode === 'missing') {
      rows = []
    }
    if (mode === 'ambiguous') {
      rows = [account, { ...account, id: 'another' }]
    }
    if (mode === 'unreachable') {
      account.sources[0].reachable = false
    }
    if (mode === 'stale') {
      limits.updatedAt = now - 300_001
    }
    if (mode === 'future') {
      account.checkedAt = now + 5001
    }
    if (mode === 'error') {
      limits.status = 'error'
    }
    if (mode === 'empty') {
      limits.session = null
      limits.weekly = null
    }
    if (mode === 'exhausted') {
      limits.weekly.usedPercent = 100
    }
    if (mode === 'retry-after') {
      limits.usageMetadata = { retryAtMs: now + 1000 }
    }
    if (mode === 'invalid') {
      limits.weekly.usedPercent = Number.NaN
    }
    expect(() => selectManagerDispatchAccount(rows, target, policy, now)).toThrow()
  })

  it('requires an explicit OpenCode provider/model binding and never pools unrelated providers', () => {
    const first = {
      ...dispatchAccount(now),
      provider: 'opencode' as const,
      providerId: 'opencode-go'
    }
    const second = { ...first, id: 'other-provider', providerId: 'zai-coding-plan' }
    expect(
      selectManagerDispatchAccount(
        [first, second],
        { ...target, agent: 'opencode', model: 'opencode-go/model' },
        policy,
        now
      ).id
    ).toBe(first.id)
    expect(
      selectManagerDispatchAccount(
        [first, second],
        { ...target, agent: 'opencode', model: 'zai-coding-plan/model' },
        policy,
        now
      ).id
    ).toBe(second.id)
    expect(() =>
      selectManagerDispatchAccount(
        [first, second],
        { ...target, agent: 'opencode', model: 'model' },
        policy,
        now
      )
    ).toThrow()
  })
})
