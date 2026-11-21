/** Keep error listeners past transfer settlement: late ssh2 STATUS callbacks emit synchronously from the socket parser, and an unhandled error kills main (#15479). Session-level protection does not cover stream emitters. */

const SSH_FX_NO_SUCH_FILE = 2

type ErrorEmitter = {
  on(event: 'error', listener: (err: Error) => void): unknown
}

export type SftpStreamErrorLatch = {
  markTransferSettled(): void
}

export function latchLateSftpStreamErrors(
  stream: ErrorEmitter,
  remotePath: string
): SftpStreamErrorLatch {
  let settled = false
  stream.on('error', (err: Error) => {
    if (!settled) {
      // The transfer's own listener owns this error and will reject with it.
      return
    }
    console.warn(
      `[sftp] Ignored late stream error for ${remotePath}: ${err instanceof Error ? err.message : String(err)}`
    )
  })
  return {
    markTransferSettled: () => {
      settled = true
    }
  }
}

/** Only NO_SUCH_FILE suggests an invisible SFTP namespace; permission denial is a mode/ownership problem, not evidence of sandboxing. */
export function isSandboxedSftpNamespaceError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === SSH_FX_NO_SUCH_FILE
}

/** POSIX can fall back to exec stdin; bundled ssh2 on Windows must report the namespace failure with actionable guidance. */
export function describeSandboxedSftpFailure(error: unknown, remotePath: string): Error {
  const detail = error instanceof Error ? error.message : String(error)
  return Object.assign(
    new Error(
      `Relay install could not reach ${remotePath} over SFTP (${detail}). ` +
        'The host answered the shell channel but its SFTP subsystem sees a different filesystem — ' +
        'typically a bastion or jump host that chroots SFTP to a transfer directory. ' +
        'Orca cannot install the relay through a sandboxed SFTP subsystem; connect to the target ' +
        'host directly (for example with ProxyJump) or allow SFTP access to the account home.',
      { cause: error }
    ),
    { sandboxedSftpNamespace: true }
  )
}

type SftpSessionEmitter = ErrorEmitter & {
  once(event: 'close', listener: () => void): unknown
  removeListener(event: 'error', listener: (err: Error) => void): unknown
}

/**
 * Hold one `'error'` listener on the SFTP *session* for as long as the session lives.
 *
 * A transfer that attaches and removes its own session listener — `writeStringViaSftp`
 * does, so a session error can reject the write in flight — leaves the emitter with zero
 * listeners between transfers and after the last one. A late STATUS reply arriving in
 * that window is the synchronous throw described above. Errors during a transfer still
 * reach that transfer first: it prepends its listener ahead of this one.
 *
 * Attach this once, right after `conn.sftp()`, on every path that runs transfers over a
 * session it owns.
 */
export function latchLateSftpSessionErrors(sftp: SftpSessionEmitter): void {
  const swallowLateSftpError = (): void => {}
  sftp.on('error', swallowLateSftpError)
  sftp.once('close', () => sftp.removeListener('error', swallowLateSftpError))
}
