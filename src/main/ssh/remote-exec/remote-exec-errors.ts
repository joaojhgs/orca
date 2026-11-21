import { redactRelayInstallMarkerTokens } from '../../managed-server/install/remote-install-marker'

export type SshCommandTerminationError = Error & {
  sshChannelCloseConfirmed: boolean
}

// Use typed timeout identity so unanswered probes cannot be mistaken for host refusal.
export const SSH_EXEC_TIMEOUT_CODE = 'SSH_EXEC_TIMEOUT'

export function isSshExecTimeout(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === SSH_EXEC_TIMEOUT_CODE
}

export function isUnconfirmedSshCommandTermination(
  error: unknown
): error is SshCommandTerminationError {
  return (
    error instanceof Error &&
    'sshChannelCloseConfirmed' in error &&
    error.sshChannelCloseConfirmed === false
  )
}

/** stdout excludes quoted command text so classifiers see host output only. */
type SshCommandExitError = Error & { exitCode: number; stdout: string }

export function isSshCommandExitError(error: unknown): error is SshCommandExitError {
  return (
    error instanceof Error &&
    'exitCode' in error &&
    typeof error.exitCode === 'number' &&
    'stdout' in error &&
    typeof error.stdout === 'string'
  )
}

export function sshCommandExitError(
  command: string,
  code: number,
  stdout: string,
  output = stdout.trim()
): SshCommandExitError {
  const message = `Command "${redactRelayInstallMarkerTokens(command)}" failed (exit ${code}): ${redactRelayInstallMarkerTokens(output)}`
  return Object.assign(new Error(message), {
    exitCode: code,
    stdout: redactRelayInstallMarkerTokens(stdout)
  })
}
