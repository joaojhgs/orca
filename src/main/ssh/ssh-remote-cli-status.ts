import type {
  CliStatusResult,
  RuntimeStatus
} from '../../shared/remote-runtime/session-graph/runtime-session-contracts'
import { runtimeHostConnectionState } from '../../shared/remote-runtime/host-status/runtime-host-connection-state'
import { projectRemoteAppStatus } from '../../shared/remote-runtime/session-graph/cli-app-status-projection'
import type { RpcResponse } from '../runtime/rpc/core'

export async function getRemoteCliStatus(
  getStatus: () => Promise<RpcResponse>
): Promise<RpcResponse> {
  const response = await getStatus()
  if (!response.ok) {
    return response
  }
  const status = response.result as RuntimeStatus
  const cliStatus: CliStatusResult = {
    target: { kind: 'environment', environment: 'ssh' },
    // Why: this answers for the Orca host the caller reached over SSH, not for the caller's
    // machine. It used to report running:true unconditionally, which claimed a desktop app
    // even for a headless `serve`; share the same projection the paired-server path uses so
    // both transports answer the question the same way (STA-4792 defect 4).
    app: projectRemoteAppStatus(status),
    runtime: {
      state: status.graphStatus === 'ready' ? 'ready' : 'graph_not_ready',
      reachable: true,
      connectionState: runtimeHostConnectionState({ hasStatusEntry: true, status }),
      runtimeId: status.runtimeId,
      // Why: `status.get` ran in-process on the execution host, so these ARE that host's
      // capabilities; dropping them made `--shell` report an outdated host instead of SSH.
      ...(status.capabilities ? { capabilities: status.capabilities } : {})
    },
    graph: { state: status.graphStatus }
  }
  return { ...response, result: cliStatus }
}
