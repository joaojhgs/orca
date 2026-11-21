import { parseExecutionHostId } from '../../../../shared/execution-host/execution-host'
import { getSshFilesystemProvider } from '../../../providers/ssh-filesystem-dispatch'

export function isRemoteTranscriptHost(hostId: string | undefined): hostId is string {
  return !!hostId && hostId !== 'local' && parseExecutionHostId(hostId)?.kind !== 'runtime'
}

export function remoteTranscriptProvider(hostId: string) {
  // Legacy clients spell the connection id without the ssh: prefix.
  const legacy = getSshFilesystemProvider(hostId)
  if (legacy) {
    return legacy
  }
  const host = parseExecutionHostId(hostId)
  return host?.kind === 'ssh' ? (getSshFilesystemProvider(host.targetId) ?? null) : null
}
