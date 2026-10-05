import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeSkillCommandHost } from './runtime-skill-command-contract'
import { createSkillPackageArchive } from '../skills/skill-package-creation'

const mocks = vi.hoisted(() => ({
  placement: vi.fn(),
  sshPlacement: vi.fn(),
  registered: vi.fn(),
  connection: vi.fn()
}))
vi.mock('../skills/skill-library-placement', () => ({
  nativeSkillLibraryPlacement: mocks.placement
}))
vi.mock('../skills/skill-library-ssh-placement', () => ({
  sshSkillLibraryPlacement: mocks.sshPlacement
}))
vi.mock('../skills/skill-library-ssh-source', () => ({
  sshSkillLibrarySource: () => {
    throw new Error('unused')
  }
}))
vi.mock('../ssh/ssh-target-registry', () => ({
  listRegisteredSshTargets: mocks.registered,
  getRegisteredSshState: () => null,
  getSshConnectionManager: () => ({ getConnection: mocks.connection })
}))
vi.mock('../providers/ssh-filesystem-dispatch', () => ({
  onSshFilesystemProviderRegistered: () => () => {},
  getSshFilesystemProvider: () => undefined
}))
import {
  disposeRuntimeSkillLibrary,
  getRuntimeSkillLibrary,
  skillLibraryWorkspaces
} from './runtime-skill-library'

const roots: string[] = []
const hosts: RuntimeSkillCommandHost[] = []
afterEach(async () => {
  hosts.splice(0).forEach(disposeRuntimeSkillLibrary)
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
  vi.resetAllMocks()
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'orca-library-runtime-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  const source = join(root, 'source')
  await mkdir(workspace)
  await mkdir(source)
  await writeFile(
    join(source, 'SKILL.md'),
    '---\nname: runtime-fixture\ndescription: fixture\n---\nFixture'
  )
  mocks.registered.mockReturnValue([{ id: 'remote', label: 'Remote' }])
  mocks.placement.mockReturnValue({
    install: async () => ({ status: 'installed' }),
    remove: async () => ({ status: 'removed' })
  })
  const createHost = (runtimeId: string): RuntimeSkillCommandHost => {
    const host: RuntimeSkillCommandHost = {
      getRuntimeId: () => runtimeId,
      getUserDataPath: () => root,
      isPackaged: () => false,
      getSettings: () => ({}),
      listRepos: () => [],
      listFolderWorkspaces: () => [{ id: 'folder', folderPath: workspace }],
      listResolvedWorktrees: async () => [],
      showManagedWorktree: async () => {
        throw new Error('unused')
      },
      getSshProvider: () => undefined,
      skillTransactionRecovery: Promise.resolve()
    }
    hosts.push(host)
    return host
  }
  const host = createHost('before-restart')
  const library = getRuntimeSkillLibrary(host)
  const imported = await library.library.importSelected(
    { reviewed: true, candidateIds: ['fixture'] },
    {
      hostId: 'local',
      discover: async () => [
        {
          id: 'fixture',
          name: 'runtime-fixture',
          description: 'fixture',
          providers: ['codex'],
          sourceKind: 'home',
          sourceLabel: 'Fixture'
        }
      ],
      package: (_id, input) => createSkillPackageArchive({ ...input, sourceDirectory: source })
    }
  )
  const version = imported.results[0].version
  if (!version) {
    throw new Error('fixture import failed')
  }
  return { root, workspace, host, library, version, createHost }
}

describe('persistent runtime library authority', () => {
  it('does not overwrite a newer removal request when an older install completes', async () => {
    const f = await fixture()
    mocks.placement.mockReturnValue({
      install: async () => {
        await f.library.library.store.transact(async (catalog) => {
          catalog.assignments[0].desiredState = 'removed'
          catalog.assignments[0].status = 'pending'
        })
        return { status: 'installed' }
      },
      remove: async () => ({ status: 'removed' })
    })
    const row = await f.library.assignments.assign({
      versionId: f.version.versionId,
      destination: { scope: 'global' },
      providers: ['codex']
    })
    expect(row).toMatchObject({ desiredState: 'removed', status: 'pending' })
    expect((await f.library.assignments.reconcile(row.id))[0].status).toBe('removed')
  })
  it('does not present an unknown worktree owner as local', async () => {
    const f = await fixture()
    f.host.listResolvedWorktrees = async () => [
      { id: 'missing-repo::/worktree', path: '/worktree' }
    ]
    expect((await skillLibraryWorkspaces(f.host)).map((row) => row.kind)).toEqual(['folder'])
  })
  it('keeps global ownership identity across runtime restarts', async () => {
    const f = await fixture()
    const row = await f.library.assignments.assign({
      versionId: f.version.versionId,
      destination: { scope: 'global' },
      providers: ['codex']
    })
    expect(row.status).toBe('installed')
    const identity = mocks.placement.mock.calls.at(-1)?.[0].destination.destinationIdentity
    disposeRuntimeSkillLibrary(f.host)
    const restarted = getRuntimeSkillLibrary(f.createHost('after-restart'))
    expect((await restarted.assignments.reconcile(row.id))[0].status).toBe('installed')
    expect(mocks.placement.mock.calls.at(-1)?.[0].destination.destinationIdentity).toBe(identity)
    expect(identity).not.toContain('before-restart')
  })

  it('pins folder assignments to their original host if the folder moves', async () => {
    const f = await fixture()
    const destination = { scope: 'workspace' as const, folderWorkspaceId: 'folder' }
    const row = await f.library.assignments.assign({
      versionId: f.version.versionId,
      destination,
      providers: ['codex']
    })
    f.host.listFolderWorkspaces = () => [
      { id: 'folder', folderPath: f.workspace, connectionId: 'remote' }
    ]
    expect((await f.library.assignments.reconcile(row.id))[0].status).toBe('failed')
    await expect(
      f.library.assignments.assign({
        versionId: f.version.versionId,
        destination,
        providers: ['codex']
      })
    ).rejects.toThrow('workspace-host-changed')
    expect(mocks.sshPlacement).not.toHaveBeenCalled()
  })

  it('persists a registered offline SSH target without native fallback', async () => {
    const f = await fixture()
    const row = await f.library.assignments.assign({
      versionId: f.version.versionId,
      destination: { scope: 'global', executionTarget: { kind: 'ssh', connectionId: 'remote' } },
      providers: ['codex']
    })
    expect(row.status).toBe('unavailable')
    expect(row.executionHostId).toBe('ssh:remote')
    expect(mocks.placement).not.toHaveBeenCalled()
    expect(mocks.sshPlacement).not.toHaveBeenCalled()
  })

  it('rejects arbitrary unregistered workspace IDs and SSH hosts', async () => {
    const f = await fixture()
    await expect(
      f.library.assignments.assign({
        versionId: f.version.versionId,
        destination: { scope: 'workspace', folderWorkspaceId: '/etc' },
        providers: ['codex']
      })
    ).rejects.toThrow('workspace-not-found')
    await expect(
      f.library.assignments.assign({
        versionId: f.version.versionId,
        destination: { scope: 'global', executionTarget: { kind: 'ssh', connectionId: 'unknown' } },
        providers: ['codex']
      })
    ).rejects.toThrow('host-not-registered')
    expect((await f.library.library.store.snapshot()).assignments).toHaveLength(0)
  })
})
