import type { PreloadApi } from '../../../../preload/api-types'
import type {
  NestedRepoScanResult,
  ProjectGroup,
  ProjectGroupImportResult
} from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import {
  callRuntimeResult,
  callRuntimeResultWithOwner,
  withRuntimeRepoOwner
} from './web-runtime-calls'
import { noopUnsubscribe } from './web-storage'

export function createWebProjectGroupsApi(): PreloadApi['projectGroups'] {
  return {
    list: async () => {
      const owned = await callRuntimeResultWithOwner<{ groups: ProjectGroup[] }>(
        'projectGroup.list'
      )
      return owned.result.groups.map((group) => ({ ...group, executionHostId: owned.hostId }))
    },
    create: async (args) => {
      const owned = await callRuntimeResultWithOwner<{ group: ProjectGroup }>(
        'projectGroup.create',
        args
      )
      return { ...owned.result.group, executionHostId: owned.hostId }
    },
    update: async (args) => {
      const owned = await callRuntimeResultWithOwner<{ group: ProjectGroup | null }>(
        'projectGroup.update',
        args
      )
      return owned.result.group ? { ...owned.result.group, executionHostId: owned.hostId } : null
    },
    delete: async (args) =>
      (await callRuntimeResult<{ deleted: boolean }>('projectGroup.delete', args)).deleted,
    moveProject: async ({ projectId, groupId, order }) => {
      const owned = await callRuntimeResultWithOwner<{ repo: Repo | null }>(
        'projectGroup.moveProject',
        {
          repo: projectId,
          groupId,
          ...(order === undefined ? {} : { order })
        }
      )
      return owned.result.repo ? withRuntimeRepoOwner(owned.result.repo, owned.hostId) : null
    },
    scanNested: async ({ path, connectionId }) => {
      // Why: this RPC scans the runtime itself, not a desktop-owned SSH connection.
      if (connectionId) {
        throw new Error(
          'Scanning nested projects on SSH hosts is unavailable in paired web clients.'
        )
      }
      return callRuntimeResult<NestedRepoScanResult>('projectGroup.scanNested', { path }, 60_000)
    },
    cancelNestedScan: async () => {
      throw new Error('Cancelling nested project scans is unavailable in paired web clients.')
    },
    onNestedScanProgress: () => noopUnsubscribe,
    importNested: async ({ parentPath, groupName, projectPaths, mode, connectionId }) => {
      if (connectionId) {
        throw new Error(
          'Importing nested projects on SSH hosts is unavailable in paired web clients.'
        )
      }
      const owned = await callRuntimeResultWithOwner<ProjectGroupImportResult>(
        'projectGroup.importNested',
        { parentPath, groupName, projectPaths, mode },
        60_000
      )
      return owned.result.group
        ? { ...owned.result, group: { ...owned.result.group, executionHostId: owned.hostId } }
        : owned.result
    }
  }
}
