import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assignSkillBatch } from './skill-library-batch-assign'
import type {
  SkillLibraryAssignment,
  SkillLibrarySnapshot,
  SkillLibraryVersion
} from '../../../../shared/skill-library-contract'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: rpc }))

function fixture() {
  const versions: SkillLibraryVersion[] = [1, 2].map((n) => ({
    packageId: `00000000-0000-4000-8000-00000000000${n}`,
    versionId: `00000000-0000-4000-8000-00000000001${n}`,
    name: `skill-${n}`,
    description: '',
    packageDigest: 'a'.repeat(64),
    archiveSha256: 'b'.repeat(64),
    compressedBytes: 100,
    createdAt: '2026-10-05T10:00:00Z',
    files: [{ path: 'SKILL.md', size: 10, executable: false, classification: 'text' }],
    origins: []
  }))
  const snapshot: SkillLibrarySnapshot = {
    schemaVersion: 1,
    versions,
    assignments: [],
    hosts: [
      { id: 'local', label: 'Server', reachable: true },
      { id: 'ssh:personal', label: 'Personal', reachable: true }
    ],
    providers: [
      { id: 'codex', displayName: 'Codex' },
      { id: 'claude', displayName: 'Claude Code' }
    ],
    workspaces: [{ id: 'project', kind: 'folder', label: 'Project', hostId: 'ssh:personal' }]
  }
  const input = {
    target: { kind: 'local' as const },
    versions,
    snapshot,
    destination: { scope: 'workspace' as const, folderWorkspaceId: 'project' },
    providers: ['codex'],
    isCurrent: () => true,
    onProgress: vi.fn()
  }
  const response = (n = 0): SkillLibraryAssignment => ({
    id: `00000000-0000-4000-8000-00000000002${n}`,
    packageId: versions[n].packageId,
    versionId: versions[n].versionId,
    destination: input.destination,
    executionHostId: 'ssh:personal',
    providers: ['codex'],
    desiredState: 'installed',
    status: 'installed',
    checkedAt: null,
    message: null
  })
  rpc.mockImplementation(async (_target, _method, request) => {
    const row = response(versions.findIndex((v) => v.versionId === request.versionId))
    return { ...row, destination: request.destination, providers: request.providers }
  })
  return { input, response }
}

beforeEach(() => vi.resetAllMocks())
describe('bulk imported skill assignment', () => {
  it('assigns sequentially to a registered SSH folder, preserving providers at that destination', async () => {
    const { input, response } = fixture()
    input.snapshot.assignments = [{ ...response(), providers: ['claude'] }]
    const results = await assignSkillBatch(input)
    expect(results.map((row) => row.status)).toEqual(['installed', 'installed'])
    expect(rpc.mock.calls.map((call) => call[2])).toEqual([
      {
        versionId: input.versions[0].versionId,
        destination: input.destination,
        providers: ['codex', 'claude']
      },
      {
        versionId: input.versions[1].versionId,
        destination: input.destination,
        providers: ['codex']
      }
    ])
    expect(input.onProgress.mock.calls.map(([row]) => row.index)).toEqual([1, 2])
    expect(rpc.mock.calls[0][3]).toEqual({ timeoutMs: 600000 })
  })
  it('does not borrow providers from another destination or removed assignments', async () => {
    const { input, response } = fixture()
    input.snapshot.assignments = [
      { ...response(), destination: { scope: 'global' }, providers: ['claude'] },
      { ...response(1), status: 'removed', providers: ['claude'] }
    ]
    await assignSkillBatch(input)
    expect(rpc.mock.calls.every((call) => call[2].providers.join(',') === 'codex')).toBe(true)
  })
  it('makes conflicts and offline queued assignments visible, without aborting unrelated skills', async () => {
    const { input, response } = fixture()
    rpc
      .mockResolvedValueOnce({ ...response(), status: 'conflict', message: 'Local edits' })
      .mockResolvedValueOnce({ ...response(1), status: 'unavailable', message: 'Host offline' })
    expect((await assignSkillBatch(input)).map((row) => row.status)).toEqual([
      'conflict',
      'unavailable'
    ])
  })
  it.each(['executionHostId', 'versionId', 'packageId', 'providers', 'destination'])(
    'stops on an unconfirmed mismatched %s response',
    async (field) => {
      const { input, response } = fixture()
      const wrong: Record<string, unknown> = {
        executionHostId: 'local',
        versionId: input.versions[1].versionId,
        packageId: input.versions[1].packageId,
        providers: ['claude'],
        destination: { scope: 'global' }
      }
      rpc.mockResolvedValueOnce({ ...response(), [field]: wrong[field] })
      expect((await assignSkillBatch(input)).map((row) => row.status)).toEqual([
        'unconfirmed',
        'not-started'
      ])
      expect(rpc).toHaveBeenCalledTimes(1)
    }
  )
  it('does not retry a timed-out operation that may still be executing', async () => {
    const { input } = fixture()
    rpc.mockRejectedValueOnce(new Error('Request timed out: skills.library.assign'))
    expect((await assignSkillBatch(input)).map((row) => row.status)).toEqual([
      'unconfirmed',
      'not-started'
    ])
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('continues after a definitive error and does not overlap requests', async () => {
    const { input, response } = fixture()
    let finish!: (value: SkillLibraryAssignment) => void
    rpc
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      .mockRejectedValueOnce(new Error('skill-library-provider-unsupported'))
    const pending = assignSkillBatch(input)
    expect(rpc).toHaveBeenCalledTimes(1)
    finish(response())
    expect((await pending).map((row) => row.status)).toEqual(['installed', 'failed'])
  })
  it('stops sending when the user changes server or leaves the dialog', async () => {
    const { input, response } = fixture()
    let current = true
    input.isCurrent = () => current
    rpc.mockImplementationOnce(async () => {
      current = false
      return response()
    })
    expect((await assignSkillBatch(input)).map((row) => row.status)).toEqual([
      'installed',
      'not-started'
    ])
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it.each([
    'missing-version',
    'duplicate-name',
    'too-many',
    'empty-providers',
    'unknown-workspace'
  ])('validates the whole batch before any writes: %s', async (kind) => {
    const { input } = fixture()
    if (kind === 'missing-version') {
      input.snapshot.versions = [input.versions[0]]
    }
    if (kind === 'duplicate-name') {
      input.versions[1].name = input.versions[0].name
    }
    if (kind === 'too-many') {
      input.versions = Array.from({ length: 51 }, (_, n) => ({
        ...input.versions[0],
        name: `skill-${n}`
      }))
    }
    if (kind === 'empty-providers') {
      input.providers = []
    }
    if (kind === 'unknown-workspace') {
      input.destination.folderWorkspaceId = 'missing'
    }
    await expect(assignSkillBatch(input)).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })
})
