import type { SshConnection } from './ssh-connection'
import { removeControlSocketPath } from './ssh-control-socket'
import { getOrcaControlSocketPath } from './system-ssh-args'

export type RelayControlConnection = Pick<
  SshConnection,
  'usesSystemSshTransport' | 'getTarget' | 'getSystemSshBuildArgsOptions'
>

export function retireSshRelayControlSocket(connection: RelayControlConnection | null): void {
  if (!connection?.usesSystemSshTransport?.()) {
    return
  }
  const socketPath = getOrcaControlSocketPath(
    connection.getTarget(),
    connection.getSystemSshBuildArgsOptions()
  )
  if (socketPath) {
    // Unlink only our reuse endpoint: existing SSH channels and remote PTYs stay alive.
    removeControlSocketPath(socketPath)
  }
}
