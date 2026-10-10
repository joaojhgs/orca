import { defineMethod } from '../core'
import { ManagerSnapshotParams } from '../../../../shared/rpc-contract/manager-params'
import { requireManagerPrincipal } from '../../manager/manager-runtime-authority'
import { managerStatusSnapshot } from '../../manager/manager-status-snapshot'
import { agentHookServer } from '../../../agent-hooks/server'
import { getRegisteredSshState } from '../../../ssh/ssh-target-registry'

export const MANAGER_OBSERVATION_METHODS = [
  defineMethod({
    name: 'manager.snapshot',
    permission: 'workspace',
    params: ManagerSnapshotParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requireManagerPrincipal(db, params.serviceToken)
      const grant = db.managerRuns.observationGrant(
        principal.id,
        db.managerPrincipals.authorize(principal.id, 'inventory:read').grant.scope
      )
      const snapshot = managerStatusSnapshot({
        grant,
        repos: runtime.listRepos(),
        setups: runtime.listProjectHostSetups(),
        folders: runtime.listFolderWorkspaces(),
        statuses: agentHookServer.getEnrichedStatusSnapshot(),
        dispatchForEvent: (event) => {
          const handle = runtime.getTerminalHandleForPaneKey(event.paneKey)
          return handle ? db.getActiveDispatchForTerminal(handle, event.paneKey) : undefined
        },
        sshConnected: (target) => getRegisteredSshState(target)?.status === 'connected',
        offset: params.offset,
        limit: params.limit
      })
      return {
        ...snapshot,
        runtimeId: runtime.getRuntimeId(),
        observedAt: Date.now(),
        cursor: db.managerEvents.headCursor(),
        checkpoint: db.managerEvents.getCheckpoint(principal.id)
      }
    }
  })
]
