import { parseExecutionHostId } from '../../../../shared/execution-host'
import { resolveFilesystemRouteForHost } from '../../../providers/execution-host-provider-dispatch'
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
  if (!parseExecutionHostId(hostId)) {
    return null
  }
  const route = resolveFilesystemRouteForHost(hostId)
  return route.kind === 'ssh' ? route.provider : null
}
