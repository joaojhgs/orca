import { afterEach, describe, expect, it, vi } from 'vitest'
import { accountUsage } from './account-usage'
import type { HandlerContext } from '../dispatch'
import type * as HostFlags from '../execution-host-flag'
import {
  ORCHESTRATION_COMPATIBILITY_HOST_ID_ENV,
  ORCHESTRATION_COMPATIBILITY_HOST_KIND_ENV,
  ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION_ENV,
  ORCHESTRATION_COMPATIBILITY_ATTACHMENT_ENV
} from '../../shared/orchestration-compatibility-evidence'

vi.mock('../execution-host-flag', async (original) => {
  const actual = await original<typeof HostFlags>()
  return {
    ...actual,
    resolveHostFlagTarget: async (flags: Map<string, string | boolean>) =>
      actual.parseHostFlag(flags)
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('account usage caller scope', () => {
  async function run(flags = new Map<string, string | boolean>()) {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const row = (id: string, hosts: string[]) => ({
      id,
      sources: hosts.map((executionHostId) => ({
        executionHostId,
        label: executionHostId,
        reachable: true
      }))
    })
    const client = {
      call: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          rateLimits: {
            claude: { unrelatedLocalCredentials: true },
            executionAccounts: [row('shared', ['local', 'ssh:personal']), row('work', ['ssh:work'])]
          }
        }
      })
    }
    await accountUsage({ flags, client, cwd: '/fixture', json: true } as unknown as HandlerContext)
    return JSON.parse(log.mock.calls.at(-1)![0])
  }

  it('defaults to local with only local sources and no unrelated native-provider state', async () => {
    vi.stubEnv(ORCHESTRATION_COMPATIBILITY_HOST_KIND_ENV, undefined)
    const result = (await run()).result
    expect(result.scope).toEqual({ mode: 'host', executionHostId: 'local' })
    expect(result.rateLimits.executionAccounts.map((row: { id: string }) => row.id)).toEqual([
      'shared'
    ])
    expect(
      result.rateLimits.executionAccounts[0].sources.map(
        (source: { executionHostId: string }) => source.executionHostId
      )
    ).toEqual(['local'])
    expect(result.rateLimits.claude).toBeUndefined()
  })

  it('defaults to the trusted SSH bridge execution host', async () => {
    vi.stubEnv(ORCHESTRATION_COMPATIBILITY_HOST_KIND_ENV, 'ssh')
    vi.stubEnv(ORCHESTRATION_COMPATIBILITY_HOST_ID_ENV, 'work')
    vi.stubEnv(ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION_ENV, 'incarnation')
    vi.stubEnv(ORCHESTRATION_COMPATIBILITY_ATTACHMENT_ENV, 'attachment')
    const result = (await run()).result
    expect(result.scope.executionHostId).toBe('ssh:work')
    expect(result.rateLimits.executionAccounts.map((row: { id: string }) => row.id)).toEqual([
      'work'
    ])
  })

  it('supports all hosts for a managing agent and an explicit execution host override', async () => {
    expect(
      (await run(new Map([['all-hosts', true]]))).result.rateLimits.executionAccounts
    ).toHaveLength(2)
    const selected = (await run(new Map([['host', 'ssh:personal']]))).result
    expect(selected.scope.executionHostId).toBe('ssh:personal')
    expect(selected.rateLimits.executionAccounts).toHaveLength(1)
  })

  it('rejects conflicting scope flags', async () => {
    await expect(
      run(
        new Map<string, string | boolean>([
          ['all-hosts', true],
          ['host', 'local']
        ])
      )
    ).rejects.toThrow('either --all-hosts or --host')
  })
})
