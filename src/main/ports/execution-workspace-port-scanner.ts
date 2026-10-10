import type { WorkspacePortScanResult } from '../../shared/workspace-ports'
import type { WorkspacePortProbeInput } from './workspace-port-ownership'
import { filterWorkspacePortProbes, scanWorkspacePortProbes } from './workspace-port-ownership'
import { executionObserverClient } from '../execution-observer/observer-client'
import { connectionManager, portForwardManager } from '../ipc/ssh-ipc-context'

/** The runtime supplies only store-owned workspace paths, grouped by their execution host. */
export async function scanExecutionWorkspacePorts(
  workspaces: readonly WorkspacePortProbeInput[],
  repoId?: string
): Promise<WorkspacePortScanResult> {
  const selected = workspaces.filter((workspace) => !repoId || workspace.repoId === repoId)
  const localProbes = filterWorkspacePortProbes(selected)
  const local: WorkspacePortScanResult =
    repoId && !localProbes.length
      ? { ports: [], scannedAt: Date.now(), platform: process.platform }
      : await scanWorkspacePortProbes(localProbes)
  const ports = [...local.ports]
  const unavailableHosts: string[] = []
  const remoteIds = [
    ...new Set(
      selected.flatMap((workspace) => (workspace.connectionId ? [workspace.connectionId] : []))
    )
  ]
  if (remoteIds.length > 64) {
    unavailableHosts.push(...remoteIds.slice(64))
  }
  // Why: scans are bounded and sequential to avoid exhausting SSH MaxSessions or host memory.
  for (const connectionId of remoteIds.slice(0, 64)) {
    const connection = connectionManager?.getConnection(connectionId)
    if (!connection || connection.getState().status !== 'connected') {
      unavailableHosts.push(connectionId)
      continue
    }
    const generation = connection.getState().connectionGeneration
    try {
      const probes = selected
        .filter((workspace) => workspace.connectionId === connectionId)
        .map(({ connectionId: _connectionId, ...workspace }) => ({ ...workspace, runsHere: true }))
      const scan = await executionObserverClient.ports(probes, connection)
      if (
        scan.unavailableReason ||
        connectionManager?.getConnection(connectionId) !== connection ||
        connection.getState().status !== 'connected' ||
        connection.getState().connectionGeneration !== generation
      ) {
        unavailableHosts.push(connectionId)
        continue
      }
      const forwards = portForwardManager?.listForwards(connectionId) ?? []
      ports.push(
        ...scan.ports.map((port) => {
          const forward = forwards.find(
            (forward) =>
              forward.remotePort === port.port &&
              (forward.remoteHost === port.connectHost ||
                (['localhost', '127.0.0.1', '::1'].includes(forward.remoteHost) &&
                  ['localhost', '127.0.0.1', '::1'].includes(port.connectHost)))
          )
          return {
            ...port,
            id: `${connectionId}:${port.id}`,
            connectionId,
            ...(forward ? { forwardedPort: forward.localPort } : {})
          }
        })
      )
    } catch {
      unavailableHosts.push(connectionId)
    }
  }
  return {
    ...local,
    scannedAt: Date.now(),
    ports,
    ...(unavailableHosts.length
      ? {
          unavailableReason: `${unavailableHosts.length} SSH host(s) are unverifiable; remote listeners were not replaced by local results.`
        }
      : {})
  }
}
