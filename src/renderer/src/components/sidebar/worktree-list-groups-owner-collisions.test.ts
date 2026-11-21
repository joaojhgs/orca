import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { ProjectGroup } from '../../../../shared/project/groups/project-group-types'
import { repo, worktree } from './worktree-list/grouping/worktree-list-groups-test-fixtures'
import { buildRows } from './worktree-list/grouping/build-rows.test-fixture'
import { getRenderRowKey } from './worktree-list/listing/render-row'

const local: ProjectGroup = {
  id: 'copied-group',
  name: 'Projects',
  parentPath: '/projects',
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1,
  executionHostId: 'local'
}
const remote: ProjectGroup = { ...local, executionHostId: 'runtime:vps' }

function rows(groups: ProjectGroup[], collapsed = new Set<string>()) {
  const localRepo = { ...repo, projectGroupId: local.id }
  const remoteRepo: Repo = {
    ...repo,
    id: 'remote-repo',
    projectGroupId: remote.id,
    executionHostId: 'runtime:vps'
  }
  const worktrees = [
    worktree,
    { ...worktree, id: 'remote-worktree', repoId: remoteRepo.id, hostId: 'runtime:vps' as const }
  ]
  return buildRows(
    'repo',
    worktrees,
    new Map([
      [localRepo.id, localRepo],
      [remoteRepo.id, remoteRepo]
    ]),
    null,
    collapsed,
    undefined,
    undefined,
    undefined,
    {},
    undefined,
    false,
    undefined,
    groups
  )
}

describe('sidebar project group owner collisions', () => {
  it('renders copied group IDs with distinct stable virtual keys and their own members', () => {
    const result = rows([local, remote])
    const keys = result.map(getRenderRowKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(
      result.flatMap((row) => (row.type === 'header' && row.projectGroup ? [row.count] : []))
    ).toEqual([1, 1])
    expect(result.filter((row) => row.type === 'item').map((row) => row.worktree.id)).toEqual([
      'wt-1',
      'remote-worktree'
    ])
  })

  it('does not repeat headers or resurrect React keys after repeated expand/collapse', () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = rows(
        [local, { ...local }, remote, { ...remote }],
        attempt % 2 ? new Set(['project-group:["local","copied-group"]']) : new Set()
      )
      const keys = result.map(getRenderRowKey)
      expect(new Set(keys).size).toBe(keys.length)
      expect(result.filter((row) => row.type === 'header' && row.projectGroup)).toHaveLength(2)
    }
  })

  it('keeps copied nested groups with their own parent owner', () => {
    const localChild = { ...local, id: 'child', parentGroupId: local.id }
    const remoteChild = { ...remote, id: 'child', parentGroupId: remote.id }
    const result = rows([local, localChild, remote, remoteChild])
    const hosts = result.flatMap((row) =>
      row.type === 'header' && row.projectGroup ? [row.hostId] : []
    )
    expect(hosts).toEqual(['local', 'local', 'runtime:vps', 'runtime:vps'])
    expect(new Set(result.map(getRenderRowKey)).size).toBe(result.length)
  })

  it('deduplicates repeated workspace snapshots without hiding a different host', () => {
    const remoteRepo: Repo = { ...repo, id: 'remote-repo', executionHostId: 'runtime:vps' }
    const remoteWorktree = { ...worktree, repoId: remoteRepo.id, hostId: 'runtime:vps' as const }
    const result = buildRows(
      'repo',
      [worktree, { ...worktree }, remoteWorktree, { ...remoteWorktree }],
      new Map([
        [repo.id, repo],
        [remoteRepo.id, remoteRepo]
      ]),
      null,
      new Set()
    )
    expect(result.filter((row) => row.type === 'item')).toHaveLength(2)
    expect(new Set(result.map(getRenderRowKey)).size).toBe(result.length)
  })
})
