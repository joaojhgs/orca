import { randomUUID } from 'node:crypto'
import {
  SkillLibraryAssignParams,
  type SkillLibraryAssignment,
  type SkillLibraryVersion
} from '../../shared/skill-library-contract'
import type {
  SkillInstallDestination,
  SkillInstallResult
} from '../../shared/skill-install-contract'
import { isSkillInstallProviderId } from '../../shared/skill-install-providers'
import type { SkillLibraryService } from './skill-library-service'

export type SkillLibraryPlacement = {
  install(
    version: SkillLibraryVersion,
    archivePath: string,
    assignment: SkillLibraryAssignment
  ): Promise<SkillInstallResult>
  remove(
    version: SkillLibraryVersion,
    assignment: SkillLibraryAssignment
  ): Promise<SkillInstallResult>
}

export type SkillLibraryPlacementResolver = {
  validate(destination: SkillInstallDestination): Promise<SkillInstallDestination>
  resolve(
    destination: SkillInstallDestination,
    executionHostId: string
  ): Promise<SkillLibraryPlacement>
  executionHostId(destination: SkillInstallDestination): Promise<string>
}

export class SkillLibraryUnavailableError extends Error {}

function destinationKey(destination: SkillInstallDestination): string {
  if (destination.scope === 'workspace') {
    return JSON.stringify([
      'workspace',
      destination.worktreeId ?? null,
      destination.folderWorkspaceId ?? null
    ])
  }
  const target = destination.executionTarget
  return JSON.stringify([
    'global',
    destination.environmentId ?? null,
    target?.kind ?? 'host',
    target?.kind === 'ssh' ? target.connectionId : target?.kind === 'wsl' ? target.distro : null
  ])
}

export class SkillLibraryAssignments {
  private readonly queue: { current: Promise<unknown> } = { current: Promise.resolve() }
  constructor(
    private readonly library: SkillLibraryService,
    private readonly resolver: SkillLibraryPlacementResolver
  ) {}

  async assign(input: unknown): Promise<SkillLibraryAssignment> {
    const request = SkillLibraryAssignParams.parse(input)
    if (request.providers.some((provider) => !isSkillInstallProviderId(provider))) {
      throw new Error('skill-library-provider-unsupported')
    }
    const destination = await this.resolver.validate(request.destination)
    const executionHostId = await this.resolver.executionHostId(destination)
    return this.serialize(async () => {
      const assignment = await this.library.store.transact(async (catalog) => {
        const version = catalog.versions.find((row) => row.versionId === request.versionId)
        if (!version) {
          throw new Error('skill-library-version-not-found')
        }
        const existing = catalog.assignments.find(
          (row) =>
            row.packageId === version.packageId &&
            destinationKey(row.destination) === destinationKey(destination)
        )
        const providers = [...new Set(request.providers)]
        if (existing) {
          if (existing.executionHostId !== executionHostId && existing.status !== 'removed') {
            throw new Error('skill-library-workspace-host-changed')
          }
          if (
            existing.providers.some((provider) => !providers.includes(provider)) &&
            existing.status !== 'removed'
          ) {
            throw new Error('skill-library-unassign-before-removing-providers')
          }
          Object.assign(existing, {
            versionId: version.versionId,
            executionHostId,
            providers,
            desiredState: 'installed',
            status: 'pending',
            message: null
          })
          return structuredClone(existing)
        }
        if (catalog.assignments.length >= 2048) {
          throw new Error('skill-library-assignment-limit')
        }
        const created: SkillLibraryAssignment = {
          id: randomUUID(),
          packageId: version.packageId,
          versionId: version.versionId,
          destination,
          executionHostId,
          providers,
          desiredState: 'installed',
          status: 'pending',
          checkedAt: null,
          message: null
        }
        catalog.assignments.push(created)
        return structuredClone(created)
      })
      return this.reconcileOne(assignment.id)
    })
  }

  unassign(id: string): Promise<SkillLibraryAssignment> {
    return this.serialize(async () => {
      await this.library.store.transact(async (catalog) => {
        const row = catalog.assignments.find((assignment) => assignment.id === id)
        if (!row) {
          throw new Error('skill-library-assignment-not-found')
        }
        row.desiredState = 'removed'
        if (row.status !== 'removed') {
          row.status = 'pending'
        }
      })
      return this.reconcileOne(id)
    })
  }

  reconcile(id?: string): Promise<SkillLibraryAssignment[]> {
    return this.serialize(async () => {
      const catalog = await this.library.store.snapshot()
      if (id && !catalog.assignments.some((row) => row.id === id)) {
        throw new Error('skill-library-assignment-not-found')
      }
      const rows = catalog.assignments.filter(
        (row) => (!id || row.id === id) && row.status !== 'removed'
      )
      const result: SkillLibraryAssignment[] = []
      for (const row of rows) {
        result.push(await this.reconcileOne(row.id))
      }
      return result
    })
  }

  private async reconcileOne(id: string): Promise<SkillLibraryAssignment> {
    const catalog = await this.library.store.snapshot()
    const assignment = catalog.assignments.find((row) => row.id === id)
    if (!assignment) {
      throw new Error('skill-library-assignment-not-found')
    }
    if (assignment.status === 'removed') {
      return assignment
    }
    const version = catalog.versions.find((row) => row.versionId === assignment.versionId)
    if (!version) {
      throw new Error('skill-library-assignment-version-missing')
    }
    try {
      const placement = await this.resolver.resolve(
        assignment.destination,
        assignment.executionHostId
      )
      const result =
        assignment.desiredState === 'installed'
          ? await placement.install(
              version,
              this.library.archivePath(version.versionId),
              assignment
            )
          : await placement.remove(version, assignment)
      assignment.status =
        result.status === 'conflict' || result.status === 'partial'
          ? 'conflict'
          : ['installed', 'updated', 'unchanged', 'removed'].includes(result.status)
            ? assignment.desiredState === 'removed'
              ? 'removed'
              : 'installed'
            : 'failed'
      assignment.message =
        assignment.status === 'conflict'
          ? 'Existing files or provider placements were preserved. Resolve local edits or unowned files before retrying.'
          : assignment.status === 'failed'
            ? 'Provisioning failed. Retry after checking the execution host.'
            : null
    } catch (error) {
      assignment.status = error instanceof SkillLibraryUnavailableError ? 'unavailable' : 'failed'
      assignment.message =
        assignment.status === 'unavailable'
          ? 'Execution host unavailable. No local fallback was used; retry when connected.'
          : 'Provisioning failed. No conflicting files were intentionally overwritten.'
    }
    assignment.checkedAt = new Date().toISOString()
    return this.library.store.transact(async (current) => {
      const row = current.assignments.find((entry) => entry.id === id)
      if (!row) {
        throw new Error('skill-library-assignment-not-found')
      }
      if (
        row.versionId !== assignment.versionId ||
        row.desiredState !== assignment.desiredState ||
        row.executionHostId !== assignment.executionHostId ||
        JSON.stringify(row.providers) !== JSON.stringify(assignment.providers)
      ) {
        return structuredClone(row)
      }
      Object.assign(row, assignment)
      return structuredClone(row)
    })
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.current.then(operation)
    this.queue.current = result.catch(() => undefined)
    return result
  }
}
