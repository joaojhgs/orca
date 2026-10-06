import { WorkspaceCleanupControlParams } from '../../../../shared/rpc-contract/workspace-cleanup-params'
import { defineMethod } from '../core'

export const WORKSPACE_CLEANUP_METHODS = [
  defineMethod({
    name: 'workspaceCleanup.control',
    params: WorkspaceCleanupControlParams,
    handler: (params, { runtime, pairedDeviceId, clientId, signal, clientKind }) => {
      if (clientKind === 'mobile') {
        throw new Error('Workspace cleanup requires a runtime client')
      }
      return runtime
        .getWorkspaceCleanupService()
        .control(params, pairedDeviceId ?? clientId ?? 'local', signal)
    }
  })
]
