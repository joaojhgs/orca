import { createHash } from 'node:crypto'
import { defineMethod } from '../core'
import {
  ManagerSnapshotParams,
  ManagerSessionReadParams,
  ManagerSessionGuideParams
} from '../../../../shared/rpc-contract/manager-params'
import { requireManagerPrincipal } from '../../manager/manager-runtime-authority'
import { requireManagerSession } from '../../manager/manager-session-authority'
import { managerWorkspaceScope } from '../../manager/manager-hook-scope'
import { managerMayObserve } from '../../../../shared/manager-event-contract'
import { ManagerAuthorityError } from '../../manager/manager-authority-error'
import { OrchestrationError } from '../../orchestration/orchestration-error'

export const MANAGER_SESSION_METHODS = [
  defineMethod({
    name: 'manager.sessionList',
    permission: 'workspace',
    params: ManagerSnapshotParams,
    handler: async (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requireManagerPrincipal(db, params.serviceToken)
      db.managerPrincipals.authorize(principal.id, 'inventory:read')
      const inventory = await runtime.listTerminals(undefined, 10_000, {
        requireFreshPtyLiveness: true,
        includeVisualLayouts: false
      })
      const grant = db.managerPrincipals.authorize(principal.id, 'inventory:read').grant.scope
      const repos = runtime.listRepos()
      const setups = runtime.listProjectHostSetups()
      const folders = runtime.listFolderWorkspaces()
      const sessions = inventory.terminals.flatMap((terminal) => {
        if (!terminal.executionHostId) {
          return []
        }
        const scope = managerWorkspaceScope(
          terminal.worktreeId,
          terminal.executionHostId,
          repos,
          setups,
          folders
        )
        if (!scope || !managerMayObserve(grant, scope)) {
          return []
        }
        // Metadata only: inventory must not leak raw transcripts through previews.
        return [
          {
            terminal: terminal.handle,
            incarnationId: terminal.incarnationId ?? null,
            scope,
            title: terminal.title,
            agent: terminal.agentIdentity ?? null,
            executionContact: terminal.connected
              ? ('connected' as const)
              : ('unverifiable' as const),
            writable: terminal.writable,
            lastOutputAt: terminal.lastOutputAt,
            ownership: 'unchanged' as const
          }
        ]
      })
      const end = params.offset + params.limit
      return {
        sessions: sessions.slice(params.offset, end),
        nextOffset: end < sessions.length ? end : null,
        truncated: inventory.truncated,
        observedAt: Date.now(),
        coverage: 'registered-terminal-inventory' as const
      }
    }
  }),
  defineMethod({
    name: 'manager.sessionRead',
    permission: 'workspace',
    params: ManagerSessionReadParams,
    handler: async (params, { runtime }) => {
      requireManagerSession(runtime, params, 'session:read')
      const terminal = await runtime.readTerminal(params.terminal, {
        cursor: params.cursor,
        limit: params.limit
      })
      requireManagerSession(runtime, params, 'session:read')
      return { terminal, incarnationId: params.incarnationId }
    }
  }),
  defineMethod({
    name: 'manager.sessionGuide',
    permission: 'workspace',
    params: ManagerSessionGuideParams,
    handler: async (params, { runtime, signal }) => {
      const db = runtime.getOrchestrationDb()
      const principal = requireManagerPrincipal(db, params.serviceToken, params.lease)
      const assertAuthority = () =>
        db.managerPrincipals.withLease(params.lease, 'session:guide', () =>
          requireManagerSession(runtime, params, 'session:guide')
        )
      const { scope } = assertAuthority()
      const identity = {
        callerFingerprint: `manager:${principal.id}`,
        requestId: params.requestId,
        method: 'manager.sessionGuide',
        payloadHash: createHash('sha256')
          .update(
            JSON.stringify({
              terminal: params.terminal,
              incarnationId: params.incarnationId,
              scope,
              body: params.body
            })
          )
          .digest('hex')
      }
      const previous = db.getMutationReceipt(identity.callerFingerprint, identity.requestId)
      if (previous) {
        if (previous.method !== identity.method || previous.payload_hash !== identity.payloadHash) {
          throw new OrchestrationError(
            'request_mismatch',
            'Session guidance request was reused with different input'
          )
        }
        if (previous.state === 'completed' && previous.receipt) {
          return JSON.parse(previous.receipt)
        }
        return {
          terminal: params.terminal,
          incarnationId: params.incarnationId,
          requestId: params.requestId,
          state: 'outcome_unknown' as const,
          reconciliationRequired: true
        }
      }
      // Never type model-authored commands into a shell or a stopped agent.
      if (!(await runtime.isTerminalRunningAgent(params.terminal))) {
        throw new ManagerAuthorityError(
          'manager_forbidden',
          'Guidance requires a confirmed running agent, not a shell'
        )
      }
      assertAuthority()
      const admitted = db.managerPrincipals.withLease(params.lease, 'session:guide', () =>
        db.beginMutationReceipt(identity)
      )
      if (admitted.disposition !== 'started') {
        return {
          terminal: params.terminal,
          incarnationId: params.incarnationId,
          requestId: params.requestId,
          state: 'outcome_unknown' as const,
          reconciliationRequired: true
        }
      }
      const send = await runtime.sendTerminalAgentPrompt(params.terminal, params.body, {
        inputKind: 'driving',
        signal,
        requestId: params.requestId,
        acceptQueued: true,
        observationTimeoutMs: 0,
        beforeWrite: async () => {
          assertAuthority()
          if (!(await runtime.isTerminalRunningAgent(params.terminal))) {
            throw new ManagerAuthorityError(
              'manager_forbidden',
              'Agent changed before guidance delivery'
            )
          }
          assertAuthority()
        },
        onInputAccepted: (accepted) =>
          db.checkpointPendingMutationReceipt({
            ...identity,
            receipt: JSON.stringify({ send: accepted })
          })
      })
      const result = {
        terminal: params.terminal,
        incarnationId: params.incarnationId,
        requestId: params.requestId,
        send,
        ownership: 'unchanged' as const
      }
      db.completeMutationReceipt({ ...identity, receipt: JSON.stringify(result) })
      return result
    }
  })
]
