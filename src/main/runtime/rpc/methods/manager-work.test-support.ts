import { vi } from 'vitest'
import { z } from 'zod'
import { OrchestrationDb } from '../../orchestration/db'
import { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { MANAGER_METHODS } from './manager'
import type { ManagerPrincipalGrant } from '../../../../shared/manager-principal-contract'
import type { Repo } from '../../../../shared/repo-types'
import { managerWorkspaceScope } from '../../manager/manager-hook-scope'

const databases: OrchestrationDb[] = []
export const repo: Repo = {
  id: 'repo',
  path: '/repo',
  displayName: 'Project',
  badgeColor: 'blue',
  addedAt: 1,
  connectionId: 'worker'
}
export const workspaceId = 'repo::/repo'
const scope = managerWorkspaceScope(workspaceId, 'ssh:worker', [repo], [])
if (!scope?.projectId) {
  throw new Error('fixture has no project scope')
}
export const grant: ManagerPrincipalGrant = {
  scope: { executionHostIds: ['ssh:worker'], projectIds: [scope.projectId], runIds: [] },
  actions: ['run:create', 'task:write', 'inventory:read', 'events:read']
}
export const runResult = z.object({ run: z.object({ id: z.string() }) })

export function fixture(customGrant = grant) {
  const db = new OrchestrationDb(':memory:')
  databases.push(db)
  const runtime = new OrcaRuntimeService()
  runtime.setOrchestrationDb(db)
  vi.spyOn(runtime, 'listRepos').mockReturnValue([repo])
  vi.spyOn(runtime, 'listProjectHostSetups').mockReturnValue([])
  vi.spyOn(runtime, 'listFolderWorkspaces').mockReturnValue([])
  vi.spyOn(runtime, 'showTerminalWorkspaceLaunchScope').mockResolvedValue({
    id: workspaceId,
    path: '/repo',
    connectionId: 'worker',
    repo,
    folderWorkspace: null
  })
  const credential = db.managerPrincipals.issue('Hermes', customGrant, Date.now() + 120_000)
  const lease = db.managerPrincipals.claim(credential.principal.id, 'adapter')
  const dispatcher = new RpcDispatcher({
    runtime,
    methods: MANAGER_METHODS,
    callerScope: { kind: 'ssh-bridge', targetId: 'worker', remoteCliControl: true }
  })
  const call = (method: string, params: unknown) =>
    dispatcher.dispatch({
      id: 'transport-request',
      authToken: 'transport-attested',
      method,
      params
    })
  const runCreate = (overrides: Record<string, unknown> = {}) =>
    call('manager.runCreate', {
      serviceToken: credential.token,
      lease,
      requestId: 'create-one',
      workspaceId,
      objective: 'Implement feature',
      ...overrides
    })
  return { db, runtime, credential, lease, call, runCreate }
}

export function cleanupManagerFixtures() {
  vi.restoreAllMocks()
  for (const db of databases.splice(0)) {
    db.close()
  }
}
