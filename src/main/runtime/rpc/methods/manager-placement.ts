import { defineMethod } from '../core'
import { ManagerSnapshotParams } from '../../../../shared/rpc-contract/manager-params'
import { requireManagerPrincipal } from '../../manager/manager-runtime-authority'
import { managerPlacementInventory } from '../../manager/manager-placement-inventory'
import { managerUsageInventory } from '../../manager/manager-usage-inventory'
import { managerWorkspaceScope } from '../../manager/manager-hook-scope'
import { managerMayObserve } from '../../../../shared/manager-event-contract'
import { normalizeWorkspaceSessionKeyToWorkspaceId } from '../../../../shared/workspace-scope'

function page<T>(items: readonly T[], offset: number, limit: number) {
  return {
    items: items.slice(offset, offset + limit),
    nextOffset: offset + limit < items.length ? offset + limit : null,
    observedAt: Date.now()
  }
}

export const MANAGER_PLACEMENT_METHODS = [
  defineMethod({
    name: 'manager.placements',
    permission: 'workspace',
    params: ManagerSnapshotParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requireManagerPrincipal(db, params.serviceToken)
      const grant = db.managerPrincipals.authorize(principal.id, 'inventory:read').grant.scope
      return page(managerPlacementInventory(runtime, grant), params.offset, params.limit)
    }
  }),
  defineMethod({
    name: 'manager.usage',
    permission: 'workspace',
    params: ManagerSnapshotParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requireManagerPrincipal(db, params.serviceToken)
      const grant = db.managerPrincipals.authorize(principal.id, 'usage:read').grant.scope
      // Reuse cached deduplicated readings; a manager cannot trigger credential refresh storms.
      const accounts = runtime.getAccountsSnapshot().rateLimits.executionAccounts ?? []
      return page(managerUsageInventory(accounts, grant, Date.now()), params.offset, params.limit)
    }
  }),
  defineMethod({
    name: 'manager.resources',
    permission: 'workspace',
    params: ManagerSnapshotParams,
    handler: async (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requireManagerPrincipal(db, params.serviceToken)
      db.managerPrincipals.authorize(principal.id, 'inventory:read')
      const snapshot = await runtime.getMemorySnapshot()
      const grant = db.managerPrincipals.authorize(principal.id, 'inventory:read').grant.scope
      const repos = runtime.listRepos()
      const setups = runtime.listProjectHostSetups()
      const folders = runtime.listFolderWorkspaces()
      const hosts = (snapshot.hosts ?? []).filter((host) =>
        grant.executionHostIds.includes(host.id)
      )
      return {
        ...page(
          hosts.map((host) => ({
            executionHostId: host.id,
            name: host.name,
            collectedAt: snapshot.collectedAt,
            availability: host.host ? ('observed' as const) : ('unverifiable' as const),
            host: host.host,
            workspaces: host.worktrees.flatMap((worktree) => {
              const workspaceId = normalizeWorkspaceSessionKeyToWorkspaceId(worktree.worktreeId)
              const scope = managerWorkspaceScope(workspaceId, host.id, repos, setups, folders)
              return scope && managerMayObserve(grant, scope)
                ? [
                    {
                      workspaceId,
                      scope,
                      cpu: worktree.cpu,
                      memory: worktree.memory,
                      sessions: worktree.sessions.map(({ sessionId, paneKey, cpu, memory }) => ({
                        sessionId,
                        paneKey,
                        cpu,
                        memory
                      }))
                    }
                  ]
                : []
            })
          })),
          params.offset,
          params.limit
        ),
        processMemoryMetric: snapshot.processMemoryMetric
      }
    }
  })
]
