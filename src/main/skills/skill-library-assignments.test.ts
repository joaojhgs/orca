import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SkillLibraryService } from './skill-library-service'
import { SkillLibraryAssignments, SkillLibraryUnavailableError } from './skill-library-assignments'
import { nativeSkillLibraryPlacement } from './skill-library-placement'
import { createSkillPackageArchive } from './skill-package-creation'
import { SKILL_INSTALL_PROVIDERS } from '../../shared/skill-install-providers'
import { resolveSkillProviderDestinations } from './skill-provider-destinations'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'orca-library-placement-'))
  roots.push(root)
  const source = join(root, 'source')
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  await Promise.all([source, home, workspace].map((path) => mkdir(path)))
  await writeFile(
    join(source, 'SKILL.md'),
    '---\nname: library-test\ndescription: library test\n---\nOriginal\n'
  )
  const library = new SkillLibraryService(join(root, 'catalog'))
  const importVersion = async (addVersion = false) =>
    (
      await library.importSelected(
        { reviewed: true, candidateIds: ['fixture'], addVersion },
        {
          hostId: 'local',
          discover: async () => [
            {
              id: 'fixture',
              name: 'library-test',
              description: 'library test',
              sourceKind: 'home',
              sourceLabel: 'Fixture',
              providers: ['codex']
            }
          ],
          package: (_id, input) => createSkillPackageArchive({ ...input, sourceDirectory: source })
        }
      )
    ).results[0].version!
  let reachable = true
  const assignments = new SkillLibraryAssignments(library, {
    validate: async (destination) => destination,
    executionHostId: async () => 'local',
    resolve: async (destination) => {
      if (!reachable) {
        throw new SkillLibraryUnavailableError()
      }
      return nativeSkillLibraryPlacement({
        destination: {
          scope: destination.scope,
          homeDirectory: home,
          ...(destination.scope === 'workspace' ? { workspaceDirectory: workspace } : {}),
          destinationIdentity: destination.scope
        },
        orcaStateDirectory: join(root, 'state'),
        hostIdentity: 'fixture'
      })
    }
  })
  return {
    root,
    source,
    home,
    workspace,
    library,
    assignments,
    importVersion,
    offline: (value: boolean) => {
      reachable = !value
    }
  }
}

describe('library assignments', () => {
  it.each(['global', 'workspace'] as const)(
    'provisions and safely removes every supported runtime at %s scope',
    async (scope) => {
      const f = await fixture()
      const version = await f.importVersion()
      const providers = SKILL_INSTALL_PROVIDERS.map((provider) => provider.id)
      const row = await f.assignments.assign({
        versionId: version.versionId,
        destination: scope === 'global' ? { scope } : { scope, folderWorkspaceId: 'fixture' },
        providers
      })
      expect(row.status).toBe('installed')
      const destinations = resolveSkillProviderDestinations({
        scope,
        homeDirectory: f.home,
        workspaceDirectory: f.workspace,
        detectedProviders: providers
      })
      for (const destination of destinations) {
        expect(
          await readFile(join(destination.rootPath, 'library-test', 'SKILL.md'), 'utf8')
        ).toContain('Original')
      }
      expect((await f.assignments.unassign(row.id)).status).toBe('removed')
      for (const destination of destinations) {
        await expect(
          readFile(join(destination.rootPath, 'library-test', 'SKILL.md'))
        ).rejects.toThrow()
      }
    }
  )
  it('provisions a pinned version, preserves source files and safely unassigns', async () => {
    const f = await fixture()
    const version = await f.importVersion()
    const row = await f.assignments.assign({
      versionId: version.versionId,
      destination: { scope: 'global' },
      providers: ['codex', 'claude']
    })
    expect(row.status).toBe('installed')
    expect(await readFile(join(f.home, '.claude/skills/library-test/SKILL.md'), 'utf8')).toContain(
      'Original'
    )
    expect((await f.assignments.unassign(row.id)).status).toBe('removed')
    await expect(readFile(join(f.home, '.agents/skills/library-test/SKILL.md'))).rejects.toThrow()
    expect(await readFile(join(f.source, 'SKILL.md'), 'utf8')).toContain('Original')
    await f.library.deleteVersion(version.versionId)
    expect((await f.library.store.snapshot()).versions).toHaveLength(0)
  })

  it('protects local changes from updates, removal and catalog deletion', async () => {
    const f = await fixture()
    const version = await f.importVersion()
    const row = await f.assignments.assign({
      versionId: version.versionId,
      destination: { scope: 'global' },
      providers: ['codex']
    })
    const path = join(f.home, '.agents/skills/library-test/SKILL.md')
    await writeFile(path, 'Locally edited')
    expect((await f.assignments.reconcile(row.id))[0].status).toBe('conflict')
    expect((await f.assignments.unassign(row.id)).status).toBe('conflict')
    await expect(f.library.deleteVersion(version.versionId)).rejects.toThrow('still-assigned')
    expect(await readFile(path, 'utf8')).toBe('Locally edited')
  })

  it('never adopts an identical original folder as a removable library installation', async () => {
    const f = await fixture()
    const version = await f.importVersion()
    const path = join(f.home, '.agents/skills/library-test')
    await mkdir(path, { recursive: true })
    const original = await readFile(join(f.source, 'SKILL.md'))
    await writeFile(join(path, 'SKILL.md'), original)
    const row = await f.assignments.assign({
      versionId: version.versionId,
      destination: { scope: 'global' },
      providers: ['codex']
    })
    expect(row.status).toBe('conflict')
    expect((await f.assignments.unassign(row.id)).status).toBe('conflict')
    expect(await readFile(join(path, 'SKILL.md'))).toEqual(original)
  })

  it('persists unavailable assignments and retries without a local fallback', async () => {
    const f = await fixture()
    const version = await f.importVersion()
    f.offline(true)
    const row = await f.assignments.assign({
      versionId: version.versionId,
      destination: { scope: 'global', executionTarget: { kind: 'ssh', connectionId: 'test-host' } },
      providers: ['codex']
    })
    expect(row.status).toBe('unavailable')
    expect((await f.library.store.snapshot()).assignments[0].status).toBe('unavailable')
    await expect(readFile(join(f.home, '.agents/skills/library-test/SKILL.md'))).rejects.toThrow()
    f.offline(false)
    expect((await f.assignments.reconcile(row.id))[0].status).toBe('installed')
  })

  it('updates only an explicit pin, never an automatically imported new version', async () => {
    const f = await fixture()
    const first = await f.importVersion()
    const destination = { scope: 'workspace' as const, folderWorkspaceId: 'fixture' }
    const row = await f.assignments.assign({
      versionId: first.versionId,
      destination,
      providers: ['codex']
    })
    await writeFile(
      join(f.source, 'SKILL.md'),
      '---\nname: library-test\ndescription: library test\n---\nUpdated\n'
    )
    const second = await f.importVersion(true)
    await f.assignments.reconcile(row.id)
    const path = join(f.workspace, '.agents/skills/library-test/SKILL.md')
    expect(await readFile(path, 'utf8')).toContain('Original')
    const updated = await f.assignments.assign({
      versionId: second.versionId,
      destination,
      providers: ['codex']
    })
    expect(updated.id).toBe(row.id)
    expect(updated.status).toBe('installed')
    expect(await readFile(path, 'utf8')).toContain('Updated')
  })

  it('rejects unsupported providers and ambiguous provider removal', async () => {
    const f = await fixture()
    const version = await f.importVersion()
    await expect(
      f.assignments.assign({
        versionId: version.versionId,
        destination: { scope: 'global' },
        providers: ['invented']
      })
    ).rejects.toThrow('provider-unsupported')
    await f.assignments.assign({
      versionId: version.versionId,
      destination: { scope: 'global' },
      providers: ['codex', 'claude']
    })
    await expect(
      f.assignments.assign({
        versionId: version.versionId,
        destination: { scope: 'global' },
        providers: ['codex']
      })
    ).rejects.toThrow('unassign-before')
  })
})
