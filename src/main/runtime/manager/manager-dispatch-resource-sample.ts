import type { HostMemory } from '../../../shared/process-stats-types'
import { parseExecutionHostId } from '../../../shared/execution-host'
import { collectHostMemory } from '../../memory/host-memory'
import { listRemoteResourceProviders } from '../../memory/remote-resource-provider-registry'
import { remoteResourceSnapshotSchema } from '../../memory/remote-resource-snapshot-schema'
import { ManagerCapacityUnavailableError } from './manager-authority-error'

export type ManagerResourceSample = {
  executionHostId: string
  host: HostMemory
  observedAt: number
}

/** Sample only the selected execution host through its existing registered resource provider. */
export async function sampleManagerDispatchResources(
  executionHostId: string
): Promise<ManagerResourceSample> {
  const target = parseExecutionHostId(executionHostId)
  const observedAt = Date.now()
  try {
    if (target?.kind === 'local') {
      return { executionHostId, host: await collectHostMemory(), observedAt }
    }
    const provider =
      target?.kind === 'ssh' &&
      listRemoteResourceProviders().find((entry) => entry.connectionId === target.targetId)
    if (provider) {
      const snapshot = remoteResourceSnapshotSchema.parse(await provider.collect())
      return { executionHostId, host: snapshot.host, observedAt }
    }
  } catch {
    // Unknown execution contact does not free reservations or authorize a replacement.
  }
  throw new ManagerCapacityUnavailableError('Selected execution-host resources are unverifiable')
}
