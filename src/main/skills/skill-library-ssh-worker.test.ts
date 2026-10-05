import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SshConnection } from '../ssh/ssh-connection'
import { runProcess } from '../../shared/child-process/run-process'
import { SkillLibraryService } from './skill-library-service'
import { SkillLibraryAssignments } from './skill-library-assignments'
import { sshSkillLibrarySource } from './skill-library-ssh-source'
import { sshSkillLibraryPlacement } from './skill-library-ssh-placement'

const mocks = vi.hoisted(() => ({ observe: vi.fn(), provider: vi.fn() }))
vi.mock('../execution-observer/observer-client', () => ({
  executionObserverClient: { observe: mocks.observe }
}))
vi.mock('../providers/ssh-filesystem-dispatch', () => ({
  getSshFilesystemProvider: mocks.provider
}))

const bundlePath = process.env.ORCA_LIBRARY_TEST_OBSERVER_BUNDLE
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
  vi.resetAllMocks()
})

async function fixture() {
  if (!bundlePath) {
    throw new Error('Build the staged observer before running these integration tests')
  }
  const root = await mkdtemp(join(tmpdir(), 'orca-library-worker-'))
  roots.push(root)
  const home = join(root, 'execution-home')
  const temporary = join(root, 'execution-tmp')
  const original = join(home, '.codex', 'skills', 'library-worker-test')
  await mkdir(original, { recursive: true })
  await mkdir(temporary)
  await writeFile(
    join(original, 'SKILL.md'),
    '---\nname: library-worker-test\ndescription: fixture\n---\nWorker instructions'
  )
  await writeFile(join(original, 'run.sh'), '#!/bin/sh\necho fixture\n')
  await chmod(join(original, 'run.sh'), 0o755)
  await writeFile(join(original, 'asset.bin'), Buffer.from([0, 255, 13]))
  const bundle = await readFile(bundlePath, 'utf8')
  mocks.observe.mockImplementation(async (request) => {
    const result = await runProcess({
      program: process.execPath,
      args: ['-'],
      cwd: home,
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, '.config'),
        TMPDIR: temporary,
        NODE_OPTIONS: '--max-old-space-size=128',
        ORCA_OBSERVER_REQUEST: Buffer.from(JSON.stringify(request)).toString('base64')
      },
      input: bundle,
      timeoutMs: 30000,
      maxOutputBytes: 1024 * 1024
    })
    const line = result.stdout
      .split('\n')
      .findLast((entry) => entry.startsWith('ORCA_OBSERVER_RESULT:'))
    if (result.code !== 0 || !line) {
      throw new Error('Fixture worker failed')
    }
    return JSON.parse(line.slice('ORCA_OBSERVER_RESULT:'.length))
  })
  let generation = 1
  let disconnectOnUpload = false
  const provider = {
    stat: async (path: string) => ({ type: 'file', size: (await stat(path)).size }),
    downloadFile: copyFile,
    openFileUploadSession: async () => ({
      uploadFile: async (source: string, target: string) => {
        await copyFile(source, target)
        if (disconnectOnUpload) {
          generation += 1
        }
      },
      close: async () => {}
    })
  }
  mocks.provider.mockReturnValue(provider)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The transport is mocked; these are the only connection methods exercised by the SSH adapters.
  const connection = {
    getTarget: () => ({ id: 'fixture-host' }),
    getState: () => ({ status: 'connected', connectionGeneration: generation })
  } as SshConnection
  const source = sshSkillLibrarySource(connection)
  const candidate = (await source.discover()).find((row) => row.name === 'library-worker-test')
  if (!candidate) {
    throw new Error('Worker discovery missed the fixture')
  }
  const library = new SkillLibraryService(join(root, 'server-library'))
  const imported = await library.importSelected(
    { hostId: source.hostId, candidateIds: [candidate.id], reviewed: true },
    source
  )
  const version = imported.results[0].version
  if (!version) {
    throw new Error('Worker import failed')
  }
  const assignments = new SkillLibraryAssignments(library, {
    validate: async (destination) => destination,
    executionHostId: async () => source.hostId,
    resolve: async () =>
      sshSkillLibraryPlacement(connection, {
        scope: 'global',
        hostIdentity: source.hostId,
        destinationIdentity: 'global:fixture-profile:ssh:fixture-host'
      })
  })
  return {
    home,
    original,
    source,
    library,
    assignments,
    version,
    disconnect: () => {
      disconnectOnUpload = true
    }
  }
}

describe.skipIf(!bundlePath)('SSH adapters with the real standalone worker', () => {
  it('imports assets and installs/removes runtime aliases without touching originals', async () => {
    const f = await fixture()
    expect(f.version.origins[0].hostId).toBe('ssh:fixture-host')
    expect(f.version.files.find((file) => file.path === 'asset.bin')?.classification).toBe('binary')
    const row = await f.assignments.assign({
      versionId: f.version.versionId,
      destination: {
        scope: 'global',
        executionTarget: { kind: 'ssh', connectionId: 'fixture-host' }
      },
      providers: ['claude', 'opencode']
    })
    const installIndex = mocks.observe.mock.calls.findIndex(
      ([request]) => request.operation === 'library-install'
    )
    expect(installIndex).toBeGreaterThanOrEqual(0)
    const installResult = await mocks.observe.mock.results[installIndex].value
    expect(installResult.status, JSON.stringify(installResult)).toBe('installed')
    expect(row.status).toBe('installed')
    const installed = join(f.home, '.claude', 'skills', 'library-worker-test')
    expect(await readFile(join(installed, 'asset.bin'))).toEqual(Buffer.from([0, 255, 13]))
    expect((await stat(join(installed, 'run.sh'))).mode & 0o111).toBeTruthy()
    expect(
      await readFile(
        join(f.home, '.config', 'opencode', 'skills', 'library-worker-test', 'SKILL.md'),
        'utf8'
      )
    ).toContain('Worker instructions')
    expect((await f.assignments.unassign(row.id)).status).toBe('removed')
    await expect(stat(installed)).rejects.toThrow()
    expect(await readFile(join(f.original, 'SKILL.md'), 'utf8')).toContain('Worker instructions')
  })

  it('does not install when the SSH generation changes during upload', async () => {
    const f = await fixture()
    f.disconnect()
    const row = await f.assignments.assign({
      versionId: f.version.versionId,
      destination: {
        scope: 'global',
        executionTarget: { kind: 'ssh', connectionId: 'fixture-host' }
      },
      providers: ['claude']
    })
    expect(row.status).toBe('unavailable')
    expect(
      mocks.observe.mock.calls.some(([request]) => request.operation === 'library-install')
    ).toBe(false)
    await expect(stat(join(f.home, '.agents', 'skills', 'library-worker-test'))).rejects.toThrow()
  })
})
