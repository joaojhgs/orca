import { describe, expect, it } from 'vitest'
import {
  makeFolderWorkspace,
  makeWorktree,
  TEST_REPO
} from '@/store/slices/worktrees-slice-test-fixtures'
import { managerWorkspaceChoices } from './manager-workspace-choices'

describe('manager workspace choices', () => {
  it('lists a controller’s nested SSH worktrees, not other runtimes or desktop-owned checkouts', () => {
    const rows = [
      makeWorktree({ id: 'local', repoId: 'repo1', hostId: 'local' }),
      makeWorktree({
        id: 'nested',
        repoId: 'repo1',
        hostId: 'ssh:worker',
        runtimeOwnerEnvironmentId: 'controller-a'
      }),
      makeWorktree({
        id: 'other',
        repoId: 'repo1',
        hostId: 'ssh:worker',
        runtimeOwnerEnvironmentId: 'controller-b'
      }),
      makeWorktree({
        id: 'archived',
        repoId: 'repo1',
        hostId: 'ssh:worker',
        runtimeOwnerEnvironmentId: 'controller-a',
        isArchived: true
      })
    ]
    const state = {
      repos: [TEST_REPO],
      worktreesByRepo: { repo1: rows },
      folderWorkspaces: [],
      projectGroups: []
    }
    expect(
      managerWorkspaceChoices(state, { kind: 'environment', environmentId: 'controller-a' }).map(
        (row) => row.id
      )
    ).toEqual(['nested'])
    expect(managerWorkspaceChoices(state, { kind: 'local' }).map((row) => row.id)).toEqual([
      'local'
    ])
  })

  it('uses canonical folder keys and keeps their endpoint ownership isolated', () => {
    const state = {
      repos: [],
      worktreesByRepo: {},
      projectGroups: [],
      folderWorkspaces: [
        makeFolderWorkspace({
          id: 'a',
          executionHostId: 'runtime:controller-a',
          connectionId: 'worker'
        }),
        makeFolderWorkspace({ id: 'b', executionHostId: 'local' })
      ]
    }
    expect(
      managerWorkspaceChoices(state, { kind: 'environment', environmentId: 'controller-a' }).map(
        (row) => row.id
      )
    ).toEqual(['folder:a'])
  })

  it('refuses duplicate bare ids on different execution hosts within one controller', () => {
    const state = {
      repos: [TEST_REPO],
      worktreesByRepo: {
        repo1: [
          makeWorktree({
            id: 'same',
            repoId: 'repo1',
            hostId: 'ssh:a',
            runtimeOwnerEnvironmentId: 'controller-a'
          }),
          makeWorktree({
            id: 'same',
            repoId: 'repo1',
            hostId: 'ssh:b',
            runtimeOwnerEnvironmentId: 'controller-a'
          })
        ]
      },
      folderWorkspaces: [],
      projectGroups: []
    }
    expect(
      managerWorkspaceChoices(state, { kind: 'environment', environmentId: 'controller-a' })
    ).toEqual([])
  })

  it('does not guess a local owner for ambiguous unqualified repo copies', () => {
    const state = {
      repos: [
        { ...TEST_REPO, executionHostId: 'runtime:controller-a' as const },
        { ...TEST_REPO, executionHostId: 'runtime:controller-b' as const }
      ],
      worktreesByRepo: { repo1: [makeWorktree({ id: 'legacy', repoId: 'repo1' })] },
      folderWorkspaces: [],
      projectGroups: []
    }
    expect(managerWorkspaceChoices(state, { kind: 'local' })).toEqual([])
  })
})
