import { StringDecoder } from 'node:string_decoder'
import type { Readable } from 'node:stream'
import type { RemoteCommandChannel } from '../../managed-server/install/remote-install-transport'
import { createSshOperationAbortError, type SshExecOptions } from '../connection/ssh-exec-options'
import {
  isCommandDecoderUnavailable,
  lacksCommandDecoder,
  rememberLacksCommandDecoder,
  type ExecTransport
} from './remote-exec-command-decoder'
import {
  redactRelayInstallMarkerError,
  redactRelayInstallMarkerTokens
} from '../../managed-server/install/remote-install-marker'
import type { SystemSshCommandChannel } from '../system-transport/system-ssh-command'
import { buildPosixStdoutFence } from '../../../shared/shell/launch/posix-stdout-fence'

import {
  SSH_EXEC_TIMEOUT_CODE,
  sshCommandExitError,
  type SshCommandTerminationError
} from './remote-exec-errors'

export {
  SSH_EXEC_TIMEOUT_CODE,
  isSshExecTimeout,
  isUnconfirmedSshCommandTermination,
  isSshCommandExitError,
  sshCommandExitError
} from './remote-exec-errors'

const EXEC_TIMEOUT_MS = 30_000
const COMMAND_CLOSE_GRACE_MS = 5_000
const MAX_EXEC_OUTPUT_CHARS = 1024 * 1024

type ExecCommandOptions = SshExecOptions & {
  timeoutMs?: number
  /** Script/input delivered over the channel, never interpolated into the shell command. */
  input?: string | Buffer
  maxOutputChars?: number
  // Log stderr separately: zero-exit probes can need diagnostics, but mixing them into stdout could match probe tokens or OpenSSH noise.
  onStderr?: (stderr: string) => void
  /** Streamed into the command's stdin, then EOF. A read error terminates the command. */
  stdin?: Readable
}

export async function execCommand(
  conn: ExecTransport,
  command: string,
  options?: ExecCommandOptions
): Promise<string> {
  if (lacksCommandDecoder(conn)) {
    return execCommandOnce(conn, command, { ...options, compressCommand: false })
  }
  try {
    return await execCommandOnce(conn, command, {
      ...options,
      // stdin is single-use and cannot replay after a decoder miss.
      compressCommand: options?.compressCommand ?? !options?.stdin
    })
  } catch (error) {
    // Decoder checks precede script execution/input consumption, so plain retry has no side effects.
    if (
      options?.stdin ||
      options?.compressCommand === false ||
      !isCommandDecoderUnavailable(error)
    ) {
      throw error
    }
    rememberLacksCommandDecoder(conn)
    return execCommandOnce(conn, command, { ...options, compressCommand: false })
  }
}

async function execCommandOnce(
  conn: ExecTransport,
  command: string,
  options?: ExecCommandOptions
): Promise<string> {
  const {
    timeoutMs = EXEC_TIMEOUT_MS,
    maxOutputChars = MAX_EXEC_OUTPUT_CHARS,
    onStderr,
    stdin,
    input,
    ...execOptions
  } = options ?? {}
  if (
    !Number.isSafeInteger(maxOutputChars) ||
    maxOutputChars < 1 ||
    maxOutputChars > 16 * 1024 * 1024
  ) {
    throw new Error('Invalid SSH command output limit')
  }
  if (stdin && input !== undefined) {
    throw new Error('Specify either SSH command stdin or input, not both')
  }
  const signal = options?.signal
  if (signal?.aborted) {
    throw createSshOperationAbortError()
  }
  // Capture transport at open: reconnect/disconnect may change the connection before this channel closes.
  const openedWithSystemSsh = conn.usesSystemSshTransport?.() === true
  // Fence login-shell startup stdout so banners/title escapes cannot become probe answers.
  const fence = execOptions.wrapCommand === false ? null : buildPosixStdoutFence(command, 'SSH')
  let channel: RemoteCommandChannel
  try {
    // Use closed stdin only when no input will be piped.
    channel =
      !stdin && input === undefined && conn.execWithClosedStdin
        ? await conn.execWithClosedStdin(fence?.command ?? command, execOptions)
        : await conn.exec(fence?.command ?? command, execOptions)
  } catch (error) {
    // Preserve identity/classifier fields while removing install-owner tokens.
    redactRelayInstallMarkerError(error)
    throw error
  }
  return new Promise((resolve, reject) => {
    let stdout = ''
    let outputFenceSeen = false
    let outputFenceClosed = false
    let pendingStdout = ''
    const decoder = new StringDecoder('utf8')
    const recordStdout = (chunk: string): void => {
      if (!fence) {
        stdout = appendExecOutputTail(stdout, chunk, maxOutputChars)
        return
      }
      pendingStdout += chunk
      if (!outputFenceSeen) {
        const begin = pendingStdout.indexOf(fence.beginMarker)
        if (begin === -1) {
          // Keep the unfenced tail too: an early shell refusal can precede the begin marker.
          pendingStdout = pendingStdout.slice(-Math.max(maxOutputChars, fence.beginMarker.length))
          return
        }
        outputFenceSeen = true
        pendingStdout = pendingStdout.slice(begin + fence.beginMarker.length)
      }
      if (outputFenceClosed) {
        pendingStdout = ''
        return
      }
      const end = pendingStdout.indexOf(fence.endMarker)
      if (end !== -1) {
        stdout = appendExecOutputTail(stdout, pendingStdout.slice(0, end), maxOutputChars)
        outputFenceClosed = true
        pendingStdout = ''
        return
      }
      const safeLength = Math.max(0, pendingStdout.length - fence.endMarker.length + 1)
      stdout = appendExecOutputTail(stdout, pendingStdout.slice(0, safeLength), maxOutputChars)
      pendingStdout = pendingStdout.slice(safeLength)
    }
    let stderr = ''
    let settled = false
    let terminationError: SshCommandTerminationError | null = null
    let closeGraceTimer: ReturnType<typeof setTimeout> | null = null

    const cleanup = (): void => {
      clearTimeout(timeout)
      if (closeGraceTimer) {
        clearTimeout(closeGraceTimer)
      }
      signal?.removeEventListener('abort', onAbort)
      channel.off('error', fail)
      channel.off('error', onInputError)
      channel.stderr.off('error', fail)
      channel.off('data', onStdoutData)
      channel.stderr.off('data', onStderrData)
      channel.off('close', onClose)
      if (stdin) {
        stdin.off('error', fail)
        stdin.unpipe(channel.stdin)
        stdin.destroy()
      }
    }
    const settle = (fn: typeof resolve | typeof reject, val: string | Error): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      fn(val as never)
    }
    const guardUnconfirmedTeardown = (): void => {
      const swallowLateError = (): void => {}
      const cleanupGuards = (): void => {
        channel.off('error', swallowLateError)
        channel.stderr.off('error', swallowLateError)
        channel.off('close', cleanupGuards)
      }
      channel.on('error', swallowLateError)
      channel.stderr.on('error', swallowLateError)
      channel.once('close', cleanupGuards)
      // Drain discarded streams after bounded teardown so ssh2 can complete CHANNEL_CLOSE.
      channel.resume()
      channel.stderr.resume()
    }
    // Wait for CHANNEL_CLOSE before settling abort or sequential fallback can race sshd's held MaxSessions slot.
    const requestTermination = (error: Error): void => {
      if (terminationError) {
        return
      }
      terminationError = Object.assign(error, { sshChannelCloseConfirmed: false })
      clearTimeout(timeout)
      // Install locks must outlive possible remote mutations; prefer confirmed close but bound broken-transport teardown.
      closeGraceTimer = setTimeout(() => {
        guardUnconfirmedTeardown()
        settle(reject, error)
      }, COMMAND_CLOSE_GRACE_MS)
      channel.close()
    }
    const fail = (err: Error): void => {
      redactRelayInstallMarkerError(err)
      requestTermination(err)
    }
    const onAbort = (): void => requestTermination(createSshOperationAbortError())
    const onInputError = (): void => fail(new Error('SSH command input could not be delivered'))
    const onStdoutData = (data: Buffer): void => {
      recordStdout(decoder.write(data))
    }
    const onStderrData = (data: Buffer): void => {
      stderr = appendExecOutputTail(stderr, data.toString('utf-8'))
    }
    const onClose = (code: number): void => {
      recordStdout(decoder.end())
      const payload = appendExecOutputTail(stdout, pendingStdout, maxOutputChars)
      if (
        !terminationError &&
        openedWithSystemSsh &&
        (channel as SystemSshCommandChannel)._closeRequested
      ) {
        terminationError = Object.assign(createSshOperationAbortError(), {
          sshChannelCloseConfirmed: false
        })
      }
      if (terminationError) {
        // Local OpenSSH exit cannot prove remote command termination, especially through ControlMaster.
        if (!openedWithSystemSsh) {
          terminationError.sshChannelCloseConfirmed = true
        }
        settle(reject, terminationError)
      } else if (code !== 0) {
        // System SSH stderr is local client noise; prefer the remote command's merged stdout.
        const output = [stderr.trim(), payload.trim()].filter(Boolean).join('\n')
        settle(reject, sshCommandExitError(command, code, payload, output))
      } else {
        if (stderr && onStderr) {
          onStderr(redactRelayInstallMarkerTokens(stderr))
        }
        settle(resolve, payload)
      }
    }
    const timeout = setTimeout(() => {
      requestTermination(
        Object.assign(
          new Error(
            `Command "${redactRelayInstallMarkerTokens(command)}" timed out after ${
              timeoutMs / 1000
            }s`
          ),
          { code: SSH_EXEC_TIMEOUT_CODE }
        )
      )
    }, timeoutMs)

    // Handle stream errors from remote reboot instead of letting EventEmitter crash main.
    signal?.addEventListener('abort', onAbort, { once: true })
    channel.on('error', fail)
    channel.stderr.on('error', fail)
    channel.on('data', onStdoutData)
    channel.stderr.on('data', onStderrData)
    channel.on('close', onClose)
    if (stdin) {
      stdin.on('error', fail)
      // Pipe to .stdin: ssh2 aliases it to channel, while system SSH ends input only there.
      stdin.pipe(channel.stdin)
    }
    if (signal?.aborted) {
      onAbort()
    } else if (input !== undefined) {
      channel.once('error', onInputError)
      channel.stdin.end(input)
    }
  })
}

function appendExecOutputTail(
  existing: string,
  chunk: string,
  limit = MAX_EXEC_OUTPUT_CHARS
): string {
  const combined = existing + chunk
  return combined.length > limit ? combined.slice(-limit) : combined
}
