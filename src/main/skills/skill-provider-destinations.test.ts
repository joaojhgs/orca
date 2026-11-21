import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveSkillProviderDestinations } from './providers/skill-provider-destinations'

const HOME = join('/home', 'dev')
const WORKSPACE = join('/repos', 'orca')

describe('resolveSkillProviderDestinations', () => {
  it('places OpenCode and Antigravity in their native roots', () => {
    expect(
      resolveSkillProviderDestinations({
        scope: 'global',
        homeDirectory: HOME,
        detectedProviders: ['opencode', 'antigravity']
      }).map((row) => [row.provider, row.rootPath])
    ).toEqual([
      ['antigravity', join(HOME, '.gemini', 'config', 'skills')],
      ['opencode', join(HOME, '.config', 'opencode', 'skills')]
    ])
    expect(
      resolveSkillProviderDestinations({
        scope: 'workspace',
        homeDirectory: HOME,
        workspaceDirectory: WORKSPACE,
        detectedProviders: ['opencode', 'antigravity']
      }).map((row) => [row.provider, row.rootPath])
    ).toEqual([
      ['antigravity', join(WORKSPACE, '.agents', 'skills')],
      ['opencode', join(WORKSPACE, '.opencode', 'skills')]
    ])
  })
})
