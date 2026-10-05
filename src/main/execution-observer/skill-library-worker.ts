import { lstat, mkdir, realpath, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  skillLibraryWorkerRequestSchema,
  type SkillLibraryWorkerRequest
} from '../../shared/skill-library-worker-contract'
import { nativeSkillLibrarySource } from '../skills/skill-library-source'
import { nativeSkillLibraryPlacement } from '../skills/skill-library-placement'
import { resolveEnvironmentSkillProviderRoots } from '../skills/skill-provider-runtime-roots'

export async function observeSkillLibrary(input: SkillLibraryWorkerRequest) {
  const request = skillLibraryWorkerRequestSchema.parse(input)
  const source = nativeSkillLibrarySource()
  if (request.operation === 'library-discover') {
    return source.discover()
  }
  if (request.operation === 'library-install' || request.operation === 'library-remove') {
    const workspace = request.destination.workspaceDirectory
    if (workspace) {
      const stat = await lstat(workspace)
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('skill-library-workspace-invalid')
      }
    }
    const placement = nativeSkillLibraryPlacement({
      destination: {
        ...request.destination,
        homeDirectory: homedir(),
        ...(workspace ? { workspaceDirectory: await realpath(workspace) } : {})
      },
      hostIdentity: request.destination.hostIdentity,
      orcaStateDirectory: join(homedir(), '.orca'),
      providerRootOverrides: resolveEnvironmentSkillProviderRoots()
    })
    const assignment = {
      id: request.version.versionId,
      packageId: request.version.packageId,
      versionId: request.version.versionId,
      destination: { scope: 'global' as const },
      executionHostId: request.destination.hostIdentity,
      providers: request.providers,
      desiredState: 'installed' as const,
      status: 'pending' as const,
      checkedAt: null,
      message: null
    }
    return request.operation === 'library-remove'
      ? placement.remove(request.version, assignment)
      : placement.install(
          request.version,
          join(tmpdir(), `orca-library-export-${request.exportId}`, 'package.tar.gz'),
          assignment
        )
  }
  const directory = join(tmpdir(), `orca-library-export-${request.exportId}`)
  if (request.operation === 'library-cleanup') {
    await rm(directory, { recursive: true, force: true })
    return { cleaned: true }
  }
  await mkdir(directory, { mode: 0o700 })
  if (request.operation === 'library-stage') {
    return { archivePath: join(directory, 'package.tar.gz') }
  }
  try {
    return await source.package(request.candidateId, {
      packageId: request.packageId,
      versionId: request.versionId,
      archivePath: join(directory, 'package.tar.gz')
    })
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
