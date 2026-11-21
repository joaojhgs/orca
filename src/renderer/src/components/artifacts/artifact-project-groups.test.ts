import { describe, expect, it } from 'vitest'
import type { ArtifactListItem } from '../../../../shared/artifacts/artifacts'
import {
  artifactProject,
  artifactProjectRoots,
  groupArtifactsByProject,
  type ArtifactProjectRoot
} from './artifact-project-groups'

const roots: ArtifactProjectRoot[] = [
  { projectId: 'personal', projectName: 'Aurora', hostId: 'ssh:desktop', path: '/projects/aurora' },
  { projectId: 'personal', projectName: 'Aurora', hostId: 'ssh:worker', path: '/projects/aurora' },
  { projectId: 'work', projectName: 'Company', hostId: 'ssh:work', path: '/projects/aurora' },
  {
    projectId: 'nested',
    projectName: 'Nested',
    hostId: 'ssh:desktop',
    path: '/projects/aurora/tools'
  }
]
const item = (sourceKey?: string): ArtifactListItem => ({
  artifact: {
    version: 1,
    slug: sourceKey ?? 'legacy',
    title: null,
    originalFileName: 'report.md',
    sourceContentType: 'text/markdown',
    renderedContentType: 'text/html',
    createdAt: '',
    updatedAt: '',
    expiresAt: '',
    byteSize: 1,
    deletedAt: null
  },
  shareUrl: 'https://orca.example/a/local-default/id/token',
  ...(sourceKey ? { sourceKey } : {})
})
const remote = (host: string, path = '/projects/aurora/report.md') =>
  item(JSON.stringify(['ssh', host, path]))

describe('artifact project provenance', () => {
  it('groups multiple host locations of one project together without merging another host account', () => {
    const groups = groupArtifactsByProject(
      [remote('desktop'), remote('worker'), remote('work')],
      roots,
      'Unassigned'
    )
    expect(groups.map((group) => [group.name, group.artifacts.length])).toEqual([
      ['Aurora', 2],
      ['Company', 1]
    ])
  })
  it('selects the longest registered root and respects path boundaries', () => {
    expect(
      artifactProject(remote('desktop', '/projects/aurora/tools/note.md'), roots)?.projectId
    ).toBe('nested')
    expect(artifactProject(remote('desktop', '/projects/aurora-other/note.md'), roots)).toBeNull()
  })
  it('does not guess a local or unknown host for missing legacy provenance', () => {
    expect(artifactProject(item('/projects/aurora/report.md'), roots)).toBeNull()
    expect(artifactProject(remote('unknown'), roots)).toBeNull()
    expect(groupArtifactsByProject([item(), item('[broken')], roots, 'Unassigned')[0]?.name).toBe(
      'Unassigned'
    )
  })
  it('does not guess between ambiguous equally specific projects', () => {
    expect(
      artifactProject(remote('desktop'), [...roots, { ...roots[0]!, projectId: 'different' }])
    ).toBeNull()
  })
  it('handles Windows separators and case without changing case-sensitive Unix paths', () => {
    const windows = [
      { projectId: 'win', projectName: 'Win', hostId: 'local', path: 'C:\\Projects\\App' }
    ]
    expect(artifactProject(item('c:/projects/app/report.md'), windows)?.projectId).toBe('win')
    expect(artifactProject(remote('desktop', '/Projects/aurora/report.md'), roots)).toBeNull()
  })
  it('maps the paired controller namespace to its own local artifact paths', () => {
    const catalog = artifactProjectRoots({
      projects: [],
      setups: [],
      worktrees: [],
      localHostId: 'runtime:controller',
      repos: [
        {
          id: 'repo',
          path: '/repo',
          displayName: 'App',
          badgeColor: '',
          addedAt: 0,
          executionHostId: 'runtime:controller'
        }
      ]
    })
    expect(artifactProject(item('/repo/report.md'), catalog)?.projectId).toBe('repo')
    expect(
      artifactProject(
        item(JSON.stringify(['editor', 'controller', 'runtime:controller', '/repo/report.md'])),
        catalog
      )?.projectId
    ).toBe('repo')
  })
  it('uses the nested SSH execution host rather than the paired controller transport', () => {
    const catalog = artifactProjectRoots({
      projects: [],
      worktrees: [],
      localHostId: 'runtime:controller',
      repos: [
        {
          id: 'repo',
          path: '/projects/aurora',
          displayName: 'Aurora',
          badgeColor: '',
          addedAt: 0,
          connectionId: 'desktop',
          executionHostId: 'runtime:controller'
        }
      ],
      setups: [
        {
          id: 'setup',
          repoId: 'repo',
          projectId: 'project',
          path: '/projects/aurora',
          displayName: 'Aurora',
          hostId: 'runtime:controller',
          executionHostId: 'ssh:desktop',
          connectionId: null,
          runtimeOwnerEnvironmentId: 'controller',
          createdAt: 0,
          updatedAt: 0,
          setupState: 'ready',
          setupMethod: 'legacy-repo'
        }
      ]
    })
    expect(artifactProject(remote('desktop'), catalog)?.projectId).toBe('project')
    expect(artifactProject(item('/projects/aurora/report.md'), catalog)).toBeNull()
  })
  it('includes registered folder and git workspace paths outside the repository checkout', () => {
    const catalog = artifactProjectRoots({
      projects: [],
      setups: [],
      repos: [
        {
          id: 'repo',
          path: '/repo',
          displayName: 'App',
          badgeColor: '',
          addedAt: 0,
          connectionId: 'desktop'
        }
      ],
      worktrees: []
    })
    expect(
      artifactProject(item(JSON.stringify(['ssh', 'desktop', '/repo/a.md'])), catalog)?.projectId
    ).toBe('repo')
  })
})
