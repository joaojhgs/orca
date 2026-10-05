import { describe, expect, it } from 'vitest'
import { skillLibraryCandidates } from './skill-library-source'
import type { SkillDiscoveryResult } from '../../shared/skills'

describe('skill library discovery completeness', () => {
  const result: SkillDiscoveryResult = {
    skills: [],
    scannedAt: 0,
    sources: [
      {
        id: 'home',
        label: 'Home',
        path: '/fixture',
        sourceKind: 'home',
        providers: ['codex'],
        owner: 'codex',
        exists: false
      }
    ]
  }
  it('allows absent runtime roots as an empty scan', () => {
    expect(
      skillLibraryCandidates({
        ...result,
        sources: result.sources.map((source) => ({ ...source, skippedReason: 'missing' }))
      })
    ).toEqual([])
  })
  it('reports unreachable sources instead of an empty successful scan', () => {
    expect(() =>
      skillLibraryCandidates({
        ...result,
        sources: result.sources.map((source) => ({ ...source, skippedReason: 'unavailable' }))
      })
    ).toThrow('discovery is incomplete')
  })
})
