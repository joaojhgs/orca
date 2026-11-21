/**
 * Keeps an SSH host's relayed `orca` CLI inside that host's own terminals.
 *
 * Without the per-target opt-in, the bridge reaches only these methods, and each selector must
 * resolve to a terminal on the bridged host; orchestration callers are bound the same way. Terminals whose host cannot be named are refused:
 * failing closed is the only safe answer for a credential that must not reach other hosts.
 */
import { toSshExecutionHostId } from '../../../shared/execution-host/execution-host'
import type { RuntimeTerminalListResult } from '../../../shared/terminal/runtime/runtime-terminal-contracts'
import type { OrcaRuntimeService } from '../orca-runtime'
import {
  findSshBridgeOrchestrationViolation,
  isHostTerminal,
  parseSshBridgeSelectors,
  type SshBridgeSelectors
} from './ssh-bridge-orchestration-binding'

import type { RpcCallerScope } from './callers/rpc-caller-scope'
import {
  SSH_BRIDGE_HOST_METHODS,
  SSH_BRIDGE_REMOTE_CONTROL_HINT,
  type SshBridgeHostBinding
} from './callers/ssh-bridge-method-policy'

export type SshBridgeResultFilter = (
  result: unknown
) => { kind: 'denied'; message: string } | { kind: 'allowed'; result: unknown }

export type SshBridgeCallBinding =
  | { kind: 'denied'; message: string }
  | { kind: 'allowed'; filterResult?: SshBridgeResultFilter }

type SshBridgeBinder = (
  runtime: OrcaRuntimeService,
  targetId: string,
  methodName: string,
  selectors: SshBridgeSelectors
) => Promise<SshBridgeCallBinding>

const bindTerminalHandle: SshBridgeBinder = async (runtime, targetId, _methodName, selectors) => {
  const handle = selectors.terminal
  return handle && (await isHostTerminal(runtime, toSshExecutionHostId(targetId), handle))
    ? { kind: 'allowed' }
    : { kind: 'denied', message: outsideHostMessage(targetId, `terminal '${handle ?? ''}'`) }
}

const bindOrchestration: SshBridgeBinder = async (runtime, targetId, methodName, selectors) => {
  const violation = await findSshBridgeOrchestrationViolation(
    runtime,
    toSshExecutionHostId(targetId),
    methodName,
    selectors
  )
  return violation
    ? { kind: 'denied', message: outsideHostMessage(targetId, violation) }
    : { kind: 'allowed' }
}

const HOST_BINDERS: Record<SshBridgeHostBinding, SshBridgeBinder> = {
  status: async () => ({ kind: 'allowed' }),
  'terminal-list': async (_runtime, targetId, _methodName, { worktree }) => ({
    kind: 'allowed',
    filterResult: (result) => filterTerminalListToHost(result, targetId, worktree)
  }),
  'terminal-handle': bindTerminalHandle,
  orchestration: bindOrchestration
}

export function bindSshBridgeCall(
  runtime: OrcaRuntimeService,
  targetId: string,
  methodName: string,
  params: unknown
): Promise<SshBridgeCallBinding> {
  const binding = SSH_BRIDGE_HOST_METHODS.get(methodName)
  // Why: the dispatcher admits only table methods, so a miss is unreachable and must fail closed.
  return binding
    ? HOST_BINDERS[binding](runtime, targetId, methodName, parseSshBridgeSelectors(params))
    : Promise.resolve({
        kind: 'denied',
        message: outsideHostMessage(targetId, `method '${methodName}'`)
      })
}

function filterTerminalListToHost(
  result: unknown,
  targetId: string,
  worktreeSelector: string | undefined
): ReturnType<SshBridgeResultFilter> {
  const hostId = toSshExecutionHostId(targetId)
  if (!isTerminalListResult(result)) {
    return { kind: 'denied', message: 'Terminal listing could not be scoped to the SSH host.' }
  }
  const terminals = result.terminals.filter((terminal) => terminal.executionHostId === hostId)
  if (worktreeSelector && terminals.length !== result.terminals.length) {
    return {
      kind: 'denied',
      message: outsideHostMessage(targetId, `worktree '${worktreeSelector}'`)
    }
  }
  const worktreeIds = new Set(terminals.map((terminal) => terminal.worktreeId))
  const scoped: RuntimeTerminalListResult = {
    terminals,
    totalCount: terminals.length,
    truncated: result.truncated && terminals.length === result.terminals.length,
    ...(result.visualLayouts
      ? {
          visualLayouts: result.visualLayouts.filter((layout) => worktreeIds.has(layout.worktreeId))
        }
      : {}),
    ...(result.topologyRevisions
      ? {
          topologyRevisions: Object.fromEntries(
            Object.entries(result.topologyRevisions).filter(([worktreeId]) =>
              worktreeIds.has(worktreeId)
            )
          )
        }
      : {}),
    ...(result.hostScope
      ? {
          hostScope: {
            hostIds: result.hostScope.hostIds.filter((id) => id === hostId),
            omittedHostIds: result.hostScope.omittedHostIds.filter((id) => id === hostId)
          }
        }
      : {})
  }
  return { kind: 'allowed', result: scoped }
}

function isTerminalListResult(value: unknown): value is RuntimeTerminalListResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'terminals' in value &&
    Array.isArray(value.terminals) &&
    'truncated' in value &&
    typeof value.truncated === 'boolean'
  )
}

function outsideHostMessage(targetId: string, subject: string): string {
  return `The orca CLI on SSH host '${targetId}' can only reach that host's own terminals and the coordinator that dispatched them, and ${subject} is outside that. ${SSH_BRIDGE_REMOTE_CONTROL_HINT}`
}

export function bindRpcCallToCallerScope(
  scope: RpcCallerScope,
  runtime: OrcaRuntimeService,
  methodName: string,
  params: unknown
): Promise<SshBridgeCallBinding> | null {
  if (scope.kind !== 'ssh-bridge' || scope.remoteCliControl) {
    return null
  }
  return bindSshBridgeCall(runtime, scope.targetId, methodName, params)
}
