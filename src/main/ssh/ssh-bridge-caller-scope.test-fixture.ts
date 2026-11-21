import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { SshBridgeCallerScope } from '../runtime/rpc/ssh-bridge-credentials'
import type { RemoteOrcaCliRequest, RemoteOrcaCliResult } from './ssh-remote-cli-host-passthrough'
import { runRemoteOrcaCli } from './ssh-remote-orca-cli'

/** A bridged SSH CLI whose host the user opted in to control Orca, i.e. the pre-scope behaviour. */
export const CONTROL_GRANTED_SSH_BRIDGE_SCOPE: SshBridgeCallerScope = {
  kind: 'ssh-bridge',
  targetId: 'box-1',
  remoteCliControl: true
}

/** The default bridge: reaches only that host's own terminals. */
export const HOST_BOUND_SSH_BRIDGE_SCOPE: SshBridgeCallerScope = {
  kind: 'ssh-bridge',
  targetId: 'box-1',
  remoteCliControl: false
}

/** The bundled CLI may exist during tests, so select the legacy dispatcher explicitly. */
export function runControlGrantedLegacyRemoteOrcaCli(
  runtime: OrcaRuntimeService,
  request: Omit<RemoteOrcaCliRequest, 'callerScope'>
): Promise<RemoteOrcaCliResult> {
  return runRemoteOrcaCli(
    runtime,
    { ...request, callerScope: CONTROL_GRANTED_SSH_BRIDGE_SCOPE },
    {
      cliEntryPath: '/host/app/out/cli/index.js',
      userDataPath: '/host/user-data',
      entryExists: () => false
    }
  )
}
