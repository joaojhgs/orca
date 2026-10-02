import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClient } from '../runtime-client'
import { SKILL_LIBRARY_HANDLERS } from './skill-library'
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

function fixture(flags = new Map<string, string | boolean>()) {
  const client = new RuntimeClient('/fixture', 60000, null, null)
  const call = vi.spyOn(client, 'call')
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const assignments = ['local', 'ssh:work'].map((executionHostId, index) => ({
    id: `assignment-${index}`,
    executionHostId,
    status: 'pending',
    providers: ['codex']
  }))
  const envelope = {
    id: 'request',
    ok: true as const,
    _meta: { runtimeId: 'runtime' },
    result: { versions: [], assignments, hosts: [], providers: [], workspaces: [] }
  }
  call.mockResolvedValue(envelope)
  const ctx: HandlerContext = { flags, client, cwd: '/fixture', json: true }
  return { ctx, call, log, envelope }
}

describe('local library CLI host scope', () => {
  it('defaults to native assignments and preserves the RPC envelope', async () => {
    vi.stubEnv(ORCHESTRATION_COMPATIBILITY_HOST_KIND_ENV, undefined)
    const f = fixture()
    await SKILL_LIBRARY_HANDLERS['skills library list'](f.ctx)
    const output = JSON.parse(f.log.mock.calls.at(-1)?.[0])
    expect(output.id).toBe('request')
    expect(output.result.scope).toEqual({ mode: 'host', executionHostId: 'local' })
    expect(output.result.assignments.map((row: { id: string }) => row.id)).toEqual(['assignment-0'])
  })

  it('defaults an SSH caller to its own environment', async () => {
    vi.stubEnv(ORCHESTRATION_COMPATIBILITY_HOST_KIND_ENV, 'ssh')
    vi.stubEnv(ORCHESTRATION_COMPATIBILITY_HOST_ID_ENV, 'work')
    vi.stubEnv(ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION_ENV, 'incarnation')
    vi.stubEnv(ORCHESTRATION_COMPATIBILITY_ATTACHMENT_ENV, 'attachment')
    const f = fixture()
    await SKILL_LIBRARY_HANDLERS['skills library list'](f.ctx)
    expect(
      JSON.parse(f.log.mock.calls.at(-1)?.[0]).result.assignments.map(
        (row: { id: string }) => row.id
      )
    ).toEqual(['assignment-1'])
  })

  it('requires an explicit host selector before removing another host assignment', async () => {
    const f = fixture(new Map([['assignment-id', 'assignment-1']]))
    await expect(SKILL_LIBRARY_HANDLERS['skills library unassign'](f.ctx)).rejects.toThrow(
      'selected host scope'
    )
    expect(f.call).not.toHaveBeenCalledWith(
      'skills.library.unassign',
      expect.anything(),
      expect.anything()
    )
    f.ctx.flags.set('host', 'ssh:work')
    await SKILL_LIBRARY_HANDLERS['skills library unassign'](f.ctx)
    expect(f.call).toHaveBeenLastCalledWith(
      'skills.library.unassign',
      { assignmentId: 'assignment-1' },
      { timeoutMs: 600000 }
    )
  })

  it('reconciles only the caller scope unless all hosts are explicit', async () => {
    const f = fixture()
    await SKILL_LIBRARY_HANDLERS['skills library reconcile'](f.ctx)
    expect(
      f.call.mock.calls
        .filter(([method]) => method === 'skills.library.reconcile')
        .map(([, params]) => params)
    ).toEqual([{ assignmentId: 'assignment-0' }])
    f.call.mockClear()
    f.ctx.flags.set('all-hosts', true)
    await SKILL_LIBRARY_HANDLERS['skills library reconcile'](f.ctx)
    expect(
      f.call.mock.calls.filter(([method]) => method === 'skills.library.reconcile')
    ).toHaveLength(2)
  })

  it('refuses unreviewed imports before discovering or mutating', async () => {
    const f = fixture(new Map([['skill', 'candidate']]))
    await expect(SKILL_LIBRARY_HANDLERS['skills library import'](f.ctx)).rejects.toThrow(
      '--reviewed'
    )
    expect(f.call).not.toHaveBeenCalled()
  })

  it('rejects conflicting host scope flags', async () => {
    const f = fixture(
      new Map<string, string | boolean>([
        ['host', 'local'],
        ['all-hosts', true]
      ])
    )
    await expect(SKILL_LIBRARY_HANDLERS['skills library list'](f.ctx)).rejects.toThrow(
      'either --host or --all-hosts'
    )
    expect(f.call).not.toHaveBeenCalled()
  })
})
