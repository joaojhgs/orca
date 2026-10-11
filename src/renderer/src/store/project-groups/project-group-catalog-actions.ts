import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import { getActiveRuntimeTarget, settingsForRuntimeOwner } from '../../runtime/runtime-rpc-client'
import type { FetchedProjectGroupCatalog } from './project-group-catalog'
import type { HostCatalogFence } from '../host-catalog-fencing'
import type { RepoSlice } from '../repos/repo-state'
import { arrayElementsUnchanged } from '../catalog-identity'
import { claimHostCatalogFence, isHostCatalogFenceCurrent } from '../host-catalog-fencing'
import {
  fetchProjectGroupCatalogForTarget,
  mergeFetchedProjectGroupCatalog
} from './project-group-catalog'
import { listRuntimeEnvironmentsForAllHostLoad } from '../runtime-catalog-hosts'
import { isWebClientLocation } from '../../lib/web-client-location'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { getProjectGroupHostId } from '../slices/project-group-owner-routing'

export function createProjectGroupCatalogActions(
  set: Parameters<StateCreator<AppState>>[0],
  get: Parameters<StateCreator<AppState>>[1]
): Pick<RepoSlice, 'fetchProjectGroups' | 'fetchProjectGroupsForAllHosts'> {
  return {
    fetchProjectGroups: async (options) => {
      try {
        const target = getActiveRuntimeTarget(
          settingsForRuntimeOwner(get().settings, options?.runtimeEnvironmentId)
        )
        const fence = claimHostCatalogFence(get, 'project-groups', target)
        const catalog = await fetchProjectGroupCatalogForTarget(target)
        if (!isHostCatalogFenceCurrent(get, fence)) {
          return
        }
        set((current) => {
          if (!isHostCatalogFenceCurrent(get, fence)) {
            return current
          }
          const { projectGroups } = mergeFetchedProjectGroupCatalog(catalog, current.projectGroups)
          if (arrayElementsUnchanged(projectGroups, current.projectGroups)) {
            return current
          }
          return {
            projectGroups,
            folderWorkspacePathStatuses: {}
          }
        })
      } catch (err) {
        console.error('Failed to fetch project groups:', err)
        if (options?.throwOnError) {
          throw err
        }
      }
    },

    fetchProjectGroupsForAllHosts: async (options) => {
      const webClient = isWebClientLocation()
      const initialTarget = webClient
        ? getActiveRuntimeTarget(get().settings)
        : { kind: 'local' as const }
      // Why: startup renders an all-host sidebar; replacing groups with only the active host leaves other hosts' repos visible but ungrouped.
      const applyCatalog = (catalog: FetchedProjectGroupCatalog, fence: HostCatalogFence): void => {
        if (!isHostCatalogFenceCurrent(get, fence)) {
          return
        }
        set((s) => {
          if (!isHostCatalogFenceCurrent(get, fence)) {
            return s
          }
          // Browsers have no local catalog; discard aliases left by the former IPC adoption path.
          const previous = webClient
            ? s.projectGroups.filter(
                (group) => parseExecutionHostId(getProjectGroupHostId(group))?.kind === 'runtime'
              )
            : s.projectGroups
          const { projectGroups } = mergeFetchedProjectGroupCatalog(catalog, previous)
          if (arrayElementsUnchanged(projectGroups, s.projectGroups)) {
            return s
          }
          return {
            projectGroups,
            folderWorkspacePathStatuses: {}
          }
        })
      }

      try {
        const target = initialTarget
        const fence = claimHostCatalogFence(get, 'project-groups', target)
        applyCatalog(await fetchProjectGroupCatalogForTarget(target), fence)
      } catch (err) {
        console.error('Failed to fetch local project groups for all-host load:', err)
      }
      if (options?.remoteHosts === 'skip') {
        return
      }

      const environments = await listRuntimeEnvironmentsForAllHostLoad()
      await Promise.all(
        environments
          .filter(
            (environment) =>
              initialTarget.kind !== 'environment' || environment.id !== initialTarget.environmentId
          )
          .map(async (environment) => {
            const target = {
              kind: 'environment' as const,
              environmentId: environment.id
            }
            const fence = claimHostCatalogFence(get, 'project-groups', target)
            try {
              applyCatalog(await fetchProjectGroupCatalogForTarget(target), fence)
            } catch (err) {
              console.warn(`Skipped project groups for runtime environment ${environment.id}:`, err)
            }
          })
      )
    }
  }
}
