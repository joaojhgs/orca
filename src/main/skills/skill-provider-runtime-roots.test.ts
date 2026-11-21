import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveEnvironmentSkillProviderRoots } from './providers/skill-provider-runtime-roots'

describe('skill provider runtime roots', () => {
  it('honors absolute OpenCode XDG config homes without disturbing the other providers', () => {
    const config = resolve('/custom/config')
    expect(resolveEnvironmentSkillProviderRoots({ XDG_CONFIG_HOME: config })).toEqual({
      opencode: join(config, 'opencode', 'skills')
    })
    expect(resolveEnvironmentSkillProviderRoots({ XDG_CONFIG_HOME: '../config' })).toEqual({})
  })
})
