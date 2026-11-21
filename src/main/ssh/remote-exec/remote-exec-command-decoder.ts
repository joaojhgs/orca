import type { RemoteInstallTransport } from '../../managed-server/install/remote-install-transport'
import {
  REMOTE_COMMAND_DECODER_UNAVAILABLE,
  REMOTE_COMMAND_DECODER_UNAVAILABLE_EXIT
} from './ssh-posix-command-wrapper'
import { isSshCommandExitError } from './remote-exec-errors'

export type ExecTransport = Pick<
  RemoteInstallTransport,
  'exec' | 'execWithClosedStdin' | 'usesSystemSshTransport'
>

// Remember missing decoders across reconnect by target id; transports without ids use object identity.
const targetsWithoutCommandDecoder = new Set<string>()
const transportsWithoutCommandDecoder = new WeakSet<ExecTransport>()

function commandDecoderTargetId(conn: ExecTransport): string | null {
  if (!('getTarget' in conn) || typeof conn.getTarget !== 'function') {
    return null
  }
  const target: unknown = conn.getTarget()
  return typeof target === 'object' &&
    target !== null &&
    'id' in target &&
    typeof target.id === 'string'
    ? target.id
    : null
}

export function lacksCommandDecoder(conn: ExecTransport): boolean {
  const id = commandDecoderTargetId(conn)
  return id === null
    ? transportsWithoutCommandDecoder.has(conn)
    : targetsWithoutCommandDecoder.has(id)
}

export function rememberLacksCommandDecoder(conn: ExecTransport): void {
  const id = commandDecoderTargetId(conn)
  if (id === null) {
    transportsWithoutCommandDecoder.add(conn)
  } else {
    targetsWithoutCommandDecoder.add(id)
  }
}

export function isCommandDecoderUnavailable(error: unknown): boolean {
  return (
    isSshCommandExitError(error) &&
    error.exitCode === REMOTE_COMMAND_DECODER_UNAVAILABLE_EXIT &&
    error.message.includes(REMOTE_COMMAND_DECODER_UNAVAILABLE)
  )
}
