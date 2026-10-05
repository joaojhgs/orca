import { describe, expect, it, vi } from 'vitest'
import {
  importSkillBatch,
  reviewSkillBatch,
  candidateSelectionKey,
  type ReviewedHostSkill
} from './skill-library-batch-import'
import type { HostedSkillCandidate } from './skill-library-host-discovery'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: rpc }))
const target = { kind: 'local' as const }
const candidate = (hostId: string, id = 'same-id'): HostedSkillCandidate => ({
  hostId,
  id,
  hostLabel: hostId,
  name: 'example',
  description: null,
  sourceLabel: 'Fixture',
  sourceKind: 'home',
  providers: ['codex']
})
const reviewed = (source: HostedSkillCandidate): ReviewedHostSkill => ({
  source,
  preview: {
    candidate: source,
    packageDigest: 'a'.repeat(64),
    files: [{ path: 'SKILL.md', size: 5, executable: false, classification: 'text' }],
    content: 'hello',
    filePath: 'SKILL.md',
    truncated: false
  }
})
describe('batch skill import', () => {
  it('does not claim a timeout proves failure or retry the import automatically', async () => {
    rpc.mockReset()
    rpc.mockRejectedValue(new Error('Request timed out: skills.library.import'))
    const results = await importSkillBatch(target, [reviewed(candidate('ssh:personal'))], false)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(results[0]).toMatchObject({ status: 'unconfirmed' })
    expect(results[0]?.message).toContain('server may still be importing')
  })
  it('reviews every host-bound selection before importing anything', async () => {
    rpc.mockReset()
    rpc.mockImplementation(async (_target, method, params) => {
      expect(method).toBe('skills.library.preview')
      return reviewed(candidate(params.hostId)).preview
    })
    const rows = await reviewSkillBatch(target, [candidate('local'), candidate('ssh:personal')])
    expect(rows.map((row) => row.source.hostId)).toEqual(['local', 'ssh:personal'])
    expect(candidateSelectionKey(rows[0]!.source)).not.toBe(candidateSelectionKey(rows[1]!.source))
  })
  it('imports each host once with all reviewed digests and preserves partial failures', async () => {
    rpc.mockReset()
    rpc.mockImplementation(async (_target, _method, params) => {
      if (params.hostId === 'ssh:offline') {
        throw new Error('Offline')
      }
      return {
        results: params.candidateIds.map((candidateId: string) => ({
          candidateId,
          status: candidateId === 'other' ? 'conflict' : 'imported'
        }))
      }
    })
    const rows = [
      reviewed(candidate('ssh:personal')),
      reviewed(candidate('ssh:personal', 'other')),
      reviewed(candidate('ssh:offline'))
    ]
    const result = await importSkillBatch(target, rows, false)
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[0]?.[2]).toMatchObject({
      hostId: 'ssh:personal',
      candidateIds: ['same-id', 'other'],
      reviewed: true,
      expectedDigests: [
        { candidateId: 'same-id', packageDigest: 'a'.repeat(64) },
        { candidateId: 'other', packageDigest: 'a'.repeat(64) }
      ]
    })
    expect(result.map((row) => row.status)).toEqual(['imported', 'conflict', 'failed'])
  })
})
