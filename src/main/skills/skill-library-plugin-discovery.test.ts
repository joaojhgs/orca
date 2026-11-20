import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { nativeSkillLibrarySource } from './skill-library-source'
import { skillLibraryPluginOrigin } from './skill-library-plugin-origin'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
it('discovers grouped plugin skills on the execution host without running hooks or following cache symlinks', async () => {
  const home = await mkdtemp(join(tmpdir(), 'orca-library-plugin-'))
  roots.push(home)
  const plugin = join(home, '.codex/plugins/cache/example/toolkit/1.0')
  await mkdir(join(plugin, '.codex-plugin'), { recursive: true })
  await writeFile(
    join(plugin, '.codex-plugin/plugin.json'),
    JSON.stringify({
      name: 'toolkit',
      version: '1.0',
      repository: 'https://github.com/example/toolkit.git'
    })
  )
  for (const name of ['first', 'second']) {
    await mkdir(join(plugin, 'skills', name), { recursive: true })
    await writeFile(
      join(plugin, 'skills', name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Fixture\n---\nInstructions`
    )
  }
  await symlink('/etc', join(home, '.codex/plugins/cache/escape'), 'dir')
  const candidates = await nativeSkillLibrarySource({ homeDir: home }).discover()
  expect(candidates.map((row) => row.name)).toEqual(['first', 'second'])
  expect(candidates[0].plugin).toMatchObject({
    name: 'toolkit',
    version: '1.0',
    source: 'https://github.com/example/toolkit',
    memberPath: 'skills/first'
  })
  expect(candidates[0].plugin?.id).toBe(candidates[1].plugin?.id)
  expect(candidates[0].plugin?.id).toBe(
    skillLibraryPluginOrigin(
      { name: 'toolkit' },
      'https://github.com/example/toolkit',
      'skills/first'
    )?.id
  )
})
