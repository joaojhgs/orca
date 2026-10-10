import { defineMethod } from '../core'
import { requireManagerPrincipal as requirePrincipal } from '../../manager/manager-runtime-authority'
import { MANAGER_OBSERVATION_METHODS } from './manager-observation'
import { MANAGER_WORK_METHODS } from './manager-work'
import { MANAGER_TASK_INVENTORY_METHODS } from './manager-task-inventory'
import { MANAGER_WORKER_OBSERVATION_METHODS } from './manager-worker-observation'
import { MANAGER_WORKER_START_METHODS } from './manager-worker-start'
import { MANAGER_MAILBOX_METHODS } from './manager-mailbox'
import { MANAGER_PLACEMENT_METHODS } from './manager-placement'
import { managerEventPolicyAllows } from '../../manager/manager-event-policy'
import {
  ManagerCheckpointParams,
  ManagerClaimParams,
  ManagerEventsReadParams,
  ManagerEventsWaitParams,
  ManagerIssueParams,
  ManagerRenewParams,
  ManagerReleaseParams,
  ManagerRevokeParams
} from '../../../../shared/rpc-contract/manager-params'

export const MANAGER_METHODS = [
  ...MANAGER_OBSERVATION_METHODS,
  ...MANAGER_WORK_METHODS,
  ...MANAGER_TASK_INVENTORY_METHODS,
  ...MANAGER_WORKER_OBSERVATION_METHODS,
  ...MANAGER_WORKER_START_METHODS,
  ...MANAGER_MAILBOX_METHODS,
  ...MANAGER_PLACEMENT_METHODS,
  defineMethod({
    name: 'manager.issue',
    permission: 'host-admin',
    params: ManagerIssueParams,
    handler: (params, { runtime }) =>
      runtime
        .getOrchestrationDb()
        .managerPrincipals.issue(params.label, params.grant, params.expiresAt)
  }),
  defineMethod({
    name: 'manager.revoke',
    permission: 'host-admin',
    params: ManagerRevokeParams,
    handler: (params, { runtime }) => ({
      revoked: runtime.getOrchestrationDb().managerPrincipals.revoke(params.principalId)
    })
  }),
  defineMethod({
    name: 'manager.eventsRead',
    permission: 'workspace',
    params: ManagerEventsReadParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requirePrincipal(db, params.serviceToken)
      const grant = db.managerRuns.observationGrant(
        principal.id,
        db.managerPrincipals.authorize(principal.id, 'events:read').grant.scope
      )
      return {
        ...db.managerEvents.read(grant, params.cursor, params.limit, (event) =>
          managerEventPolicyAllows(runtime.getManagerEventPolicy(), event)
        ),
        checkpoint: db.managerEvents.getCheckpoint(principal.id)
      }
    }
  }),
  defineMethod({
    name: 'manager.eventsWait',
    permission: 'workspace',
    params: ManagerEventsWaitParams,
    handler: async (params, { runtime, signal }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requirePrincipal(db, params.serviceToken)
      const authorize = () => {
        db.managerPrincipals.authorize(principal.id, 'events:read')
      }
      authorize()
      return await db.managerEvents.wait(
        () =>
          db.managerRuns.observationGrant(
            principal.id,
            db.managerPrincipals.authorize(principal.id, 'events:read').grant.scope
          ),
        params.cursor,
        params.timeoutMs,
        authorize,
        signal,
        (event) => managerEventPolicyAllows(runtime.getManagerEventPolicy(), event)
      )
    }
  }),
  defineMethod({
    name: 'manager.consumerClaim',
    permission: 'workspace',
    params: ManagerClaimParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requirePrincipal(db, params.serviceToken)
      db.managerPrincipals.authorize(principal.id, 'events:checkpoint')
      return {
        lease: db.managerPrincipals.claim(principal.id, params.consumerId, params.durationMs)
      }
    }
  }),
  defineMethod({
    name: 'manager.consumerRenew',
    permission: 'workspace',
    params: ManagerRenewParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      requirePrincipal(db, params.serviceToken, params.lease)
      db.managerPrincipals.renew(params.lease, params.durationMs)
      return { renewed: true }
    }
  }),
  defineMethod({
    name: 'manager.consumerRelease',
    permission: 'workspace',
    params: ManagerReleaseParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      requirePrincipal(db, params.serviceToken, params.lease)
      db.managerPrincipals.release(params.lease)
      return { released: true }
    }
  }),
  defineMethod({
    name: 'manager.eventsCheckpoint',
    permission: 'workspace',
    params: ManagerCheckpointParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requirePrincipal(db, params.serviceToken, params.lease)
      db.managerPrincipals.withLease(params.lease, 'events:checkpoint', () => {
        db.managerEvents.checkpoint(principal.id, params.cursor)
      })
      return { checkpoint: db.managerEvents.getCheckpoint(principal.id) }
    }
  })
]
