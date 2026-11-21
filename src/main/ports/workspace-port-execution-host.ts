import type { DetectedPort } from '../../shared/remote-runtime/ssh/ssh-types'
import { connectHostForBindHost } from './local-workspace-port-address'
import {
  normalizeExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host/execution-host'
import type {
  WorkspacePort,
  WorkspacePortHostKillRequest,
  WorkspacePortHostScanResult,
  WorkspacePortKillResult,
  WorkspacePortProbe
} from '../../shared/workspace/ports/workspace-ports'
import { killWorkspacePort, scanWorkspacePortProbes } from './workspace-port-ownership'

export type WorkspacePortExecutionHostDeps = {
  /** Workspaces this host runs itself; the only processes Stop may signal here. */
  getLocalProbes: () => Promise<WorkspacePortProbe[]>
  getSshMultiplexer?: (targetId: string) =>
    | {
        request(
          method: string,
          params?: Record<string, unknown>,
          options?: { timeoutMs?: number }
        ): Promise<unknown>
      }
    | undefined
}

export const SSH_PORT_SCAN_UNSUPPORTED_REASON =
  "Port detection isn't available for direct SSH hosts yet. Move this project to an Orca server on this host to see its ports."

function unavailable(executionHostId: string, reason: string): WorkspacePortHostScanResult {
  return {
    executionHostId,
    platform: 'unknown',
    scannedAt: Date.now(),
    ports: [],
    unavailableReason: reason
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isDetectedPort(value: unknown): value is DetectedPort {
  if (!value || typeof value !== 'object') {
    return false
  }
  const port: { port?: unknown; host?: unknown; pid?: unknown; processName?: unknown } = value
  return (
    typeof port.port === 'number' &&
    Number.isSafeInteger(port.port) &&
    typeof port.host === 'string' &&
    (port.pid === undefined || typeof port.pid === 'number') &&
    (port.processName === undefined || typeof port.processName === 'string')
  )
}

// Why `external`: the relay reports listeners without workspace attribution, so no row it returns
// can be treated as workspace-owned (which is what makes a row stoppable).
function toUnattributedPort(port: DetectedPort): WorkspacePort {
  return {
    id: `${port.host}:${port.port}:${port.pid ?? 'unknown'}`,
    kind: 'external',
    bindHost: port.host,
    connectHost: connectHostForBindHost(port.host),
    port: port.port,
    ...(port.pid !== undefined ? { pid: port.pid } : {}),
    ...(port.processName !== undefined ? { processName: port.processName } : {}),
    protocol: 'unknown'
  }
}

async function scanSshExecutionHost(
  executionHostId: string,
  targetId: string,
  deps: WorkspacePortExecutionHostDeps
): Promise<WorkspacePortHostScanResult> {
  let response: unknown
  try {
    const mux = deps.getSshMultiplexer?.(targetId)
    if (!mux) {
      return unavailable(
        executionHostId,
        deps.getSshMultiplexer ? 'The SSH host is not connected.' : SSH_PORT_SCAN_UNSUPPORTED_REASON
      )
    }
    response = await mux.request('ports.detect', undefined, {
      timeoutMs: 10_000
    })
  } catch (error) {
    return unavailable(executionHostId, `Could not scan the SSH host: ${errorMessage(error)}`)
  }
  const result: { ports?: unknown; platform?: unknown } =
    response && typeof response === 'object' ? response : {}
  if (!Array.isArray(result.ports) || !result.ports.every(isDetectedPort)) {
    return unavailable(executionHostId, 'The SSH host returned an invalid port scan.')
  }
  // Why: the relay answers an empty list on platforms it cannot scan; that is "could not look".
  if (result.platform !== 'linux' && result.platform !== 'win32') {
    return unavailable(executionHostId, 'Port detection is not supported on this SSH host.')
  }
  return {
    executionHostId,
    platform: result.platform,
    scannedAt: Date.now(),
    ports: result.ports.map(toUnattributedPort)
  }
}

export async function scanWorkspacePortsOnExecutionHost(
  executionHostId: ExecutionHostId,
  deps: WorkspacePortExecutionHostDeps
): Promise<WorkspacePortHostScanResult> {
  const host = parseExecutionHostId(executionHostId)
  if (host?.kind === 'local') {
    return { ...(await scanWorkspacePortProbes(await deps.getLocalProbes())), executionHostId }
  }
  if (host?.kind === 'ssh') {
    return scanSshExecutionHost(executionHostId, host.targetId, deps)
  }
  return unavailable(executionHostId, 'This workspace does not run on this server.')
}

/** Signal only when current workspace host matches scanned host; PID numbers can repeat across machines. */
export async function killWorkspacePortOnExecutionHost(
  resolvedHostId: ExecutionHostId,
  request: Omit<WorkspacePortHostKillRequest, 'worktree'>,
  deps: WorkspacePortExecutionHostDeps
): Promise<WorkspacePortKillResult> {
  if (normalizeExecutionHostId(request.executionHostId) !== resolvedHostId) {
    return {
      ok: false,
      reason: 'This port was found on a different host than the workspace runs on. Rescan first.'
    }
  }
  const host = parseExecutionHostId(resolvedHostId)
  if (host?.kind === 'local') {
    return killWorkspacePort(await deps.getLocalProbes(), { pid: request.pid, port: request.port })
  }
  // Unserved SSH ownership cannot authorize Stop; refuse rather than signal this machine.
  if (host?.kind === 'ssh') {
    return { ok: false, reason: 'Stopping processes on an SSH host is not supported yet.' }
  }
  return { ok: false, reason: 'This workspace does not run on this server.' }
}
