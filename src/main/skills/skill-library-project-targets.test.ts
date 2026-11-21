import { expect, it } from 'vitest'
import { skillLibraryProjectTargets } from './skill-library-project-targets'

it('restricts project destinations to registered repositories and their execution hosts', () => {
  const result = skillLibraryProjectTargets(
    [{ id: 'personal', displayName: 'Personal', sourceRepoIds: ['desktop', 'worker'] }],
    [
      { id: 'desktop', path: '/projects/game', connectionId: 'desktop' },
      { id: 'worker', path: '/projects/game', connectionId: 'worker' }
    ],
    [
      { id: 'one', kind: 'folder', label: '/projects/game/docs', hostId: 'ssh:desktop' },
      { id: 'two', kind: 'folder', label: '/projects/game', hostId: 'ssh:worker' },
      { id: 'three', kind: 'folder', label: '/projects/game-private', hostId: 'ssh:desktop' },
      { id: 'four', kind: 'folder', label: '/projects/game', hostId: 'ssh:work' }
    ]
  )
  expect(result).toEqual([
    { id: 'personal', label: 'Personal', workspaceKeys: ['folder:one', 'folder:two'] }
  ])
})
