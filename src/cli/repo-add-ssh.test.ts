import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { callMock, runtimeClientConstructorMock, serveOrcaAppMock, getDefaultUserDataPathMock } =
  vi.hoisted(() => ({
    callMock: vi.fn(),
    runtimeClientConstructorMock: vi.fn(),
    serveOrcaAppMock: vi.fn(),
    getDefaultUserDataPathMock: vi.fn(() => '/tmp/orca-user-data')
  }))
vi.mock('./runtime-client', async () => {
  const { createRuntimeClientModuleMock } = await import('./index-test-harness.js')
  return createRuntimeClientModuleMock({
    callMock,
    runtimeClientConstructorMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock
  })
})
import { main } from './index'
import { okFixture, queueFixtures } from './test-fixtures'
beforeEach(() => {
  callMock.mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
})
describe('SSH repository registration compatibility', () => {
  it('passes an SSH execution host when registering a remote checkout', async () => {
    queueFixtures(
      callMock,
      okFixture('req_repo_add', {
        repo: {
          id: 'repo-remote',
          path: '/home/developer/multica_workspaces/task/workdir',
          displayName: 'workdir'
        }
      })
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      [
        'repo',
        'add',
        '--path',
        '/home/developer/multica_workspaces/task/workdir',
        '--host',
        'ssh:ssh-personal',
        '--json'
      ],
      '/tmp/repo'
    )

    expect(callMock).toHaveBeenCalledWith('repo.add', {
      path: '/home/developer/multica_workspaces/task/workdir',
      host: 'ssh:ssh-personal'
    })
  })

  it('registers a non-Git directory as an SSH folder workspace', async () => {
    queueFixtures(
      callMock,
      okFixture('req_repo_add', {
        repo: {
          id: 'folder-remote',
          path: '/home/developer/multica_workspaces/task/workdir',
          displayName: 'workdir',
          kind: 'folder'
        }
      })
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      [
        'repo',
        'add',
        '--path',
        '/home/developer/multica_workspaces/task/workdir',
        '--kind',
        'folder',
        '--host',
        'ssh:ssh-personal',
        '--json'
      ],
      '/tmp/repo'
    )

    expect(callMock).toHaveBeenCalledWith('repo.add', {
      path: '/home/developer/multica_workspaces/task/workdir',
      kind: 'folder',
      host: 'ssh:ssh-personal'
    })
  })

  it('groups a folder workspace under an existing GitHub project', async () => {
    queueFixtures(
      callMock,
      okFixture('req_project_list', {
        projects: [
          {
            id: 'github:joaojhgs/aurora',
            displayName: 'aurora',
            badgeColor: '#7c3aed',
            providerIdentity: {
              provider: 'github',
              owner: 'joaojhgs',
              repo: 'aurora'
            },
            sourceRepoIds: ['aurora-main'],
            createdAt: 1,
            updatedAt: 1
          }
        ]
      }),
      okFixture('req_repo_add', {
        repo: {
          id: 'folder-remote',
          path: '/home/developer/multica_workspaces/task/workdir',
          displayName: 'workdir',
          kind: 'folder'
        }
      }),
      okFixture('req_repo_update', {
        repo: {
          id: 'folder-remote',
          path: '/home/developer/multica_workspaces/task/workdir',
          displayName: 'workdir',
          kind: 'folder',
          upstream: { owner: 'joaojhgs', repo: 'aurora' }
        }
      })
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      [
        'repo',
        'add',
        '--path',
        '/home/developer/multica_workspaces/task/workdir',
        '--kind',
        'folder',
        '--host',
        'ssh:ssh-personal',
        '--project',
        'github:joaojhgs/aurora',
        '--json'
      ],
      '/tmp/repo'
    )

    expect(callMock).toHaveBeenNthCalledWith(1, 'project.list')
    expect(callMock).toHaveBeenNthCalledWith(2, 'repo.add', {
      path: '/home/developer/multica_workspaces/task/workdir',
      kind: 'folder',
      host: 'ssh:ssh-personal'
    })
    expect(callMock).toHaveBeenNthCalledWith(3, 'repo.update', {
      repo: 'id:folder-remote',
      updates: { upstream: { owner: 'joaojhgs', repo: 'aurora' } }
    })
  })
})
