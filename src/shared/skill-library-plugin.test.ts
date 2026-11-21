import { describe, expect, it } from 'vitest'
import {
  groupLibrarySkills,
  libraryVersionPlugins,
  preferredLibraryVersions,
  toggleLibrarySelection,
  SkillLibraryPluginSchema
} from './skill-library-plugin'

const plugin = {
  id: 'a'.repeat(64),
  name: 'example',
  source: 'https://github.com/example/plugins',
  memberPath: 'skills/first'
}
describe('plugin skill grouping', () => {
  it('retains plugin grouping for single or partial member selections and keeps individual skills', () => {
    const rows = [
      { name: 'first', plugin },
      { name: 'second', plugin },
      { name: 'third', plugin: null }
    ]
    expect(
      groupLibrarySkills(rows, (row) => (row.plugin ? [row.plugin] : [])).map((group) => [
        group.id,
        group.rows.length
      ])
    ).toEqual([
      [plugin.id, 2],
      ['individual', 1]
    ])
    expect(
      groupLibrarySkills(rows.slice(0, 1), (row) => (row.plugin ? [row.plugin] : []))[0].plugin
    ).toEqual(plugin)
    expect(libraryVersionPlugins({ origins: [{ plugin }, { plugin }] })).toEqual([plugin])
  })
  it('selects and deselects groups without dropping unrelated selections or silently truncating groups', () => {
    const selected = toggleLibrarySelection(new Set(['outside']), ['one', 'two'], true)
    expect([...selected]).toEqual(['outside', 'one', 'two'])
    expect([...toggleLibrarySelection(selected, ['one'], false)]).toEqual(['outside', 'two'])
    expect([...toggleLibrarySelection(new Set(['outside']), ['one', 'two'], true, 2)]).toEqual([
      'outside'
    ])
  })
  it('uses only the latest imported version per skill for whole-plugin operations', () => {
    expect(
      preferredLibraryVersions([
        { name: 'one', createdAt: '2026-01-01' },
        { name: 'one', createdAt: '2026-02-01' }
      ])
    ).toEqual([{ name: 'one', createdAt: '2026-02-01' }])
  })
  it('bounds untrusted origin metadata', () => {
    expect(SkillLibraryPluginSchema.safeParse({ ...plugin, id: '../escape' }).success).toBe(false)
    expect(SkillLibraryPluginSchema.safeParse({ ...plugin, totalSkills: 2001 }).success).toBe(false)
  })
  it('keeps cached plugin versions separate in discovery without changing their stable identity', () => {
    const rows = [
      { plugin: { ...plugin, version: '1.0' } },
      { plugin: { ...plugin, version: '2.0' } }
    ]
    expect(groupLibrarySkills(rows, (row) => [row.plugin], true)).toHaveLength(2)
    expect(groupLibrarySkills(rows, (row) => [row.plugin])).toHaveLength(1)
  })
})
