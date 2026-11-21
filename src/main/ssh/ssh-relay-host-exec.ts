import type { SshConnection } from './connection/ssh-connection'
import { execCommand } from './ssh-relay-deploy-helpers'
import type { RemoteHostPlatform } from './remote-host/ssh-remote-platform'

export function execHostCommand(
  conn: SshConnection,
  host: RemoteHostPlatform,
  command: string,
  options?: { signal?: AbortSignal; timeoutMs?: number; onStderr?: (stderr: string) => void }
): Promise<string> {
  // Why the dialect, not the os: the wrapper is POSIX shell, so it follows the command dialect.
  return execCommand(conn, command, {
    wrapCommand: host.commandDialect !== 'powershell',
    ...options
  })
}
