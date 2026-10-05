import type { Store } from '../persistence'
import { connectionManager } from '../ipc/ssh-ipc-context'
import { executionObserverClient } from './observer-client'
import type { UsageExecutionHost } from '../rate-limits/execution-account-usage-service'
import { LOCAL_EXECUTION_HOST_ID, toSshExecutionHostId } from '../../shared/execution-host'

export function getUsageExecutionHosts(store: Pick<Store, 'getSshTargets'>): UsageExecutionHost[] {
  const hosts: UsageExecutionHost[] = [
    {
      id: LOCAL_EXECUTION_HOST_ID,
      label: 'Orca server',
      generation: 0,
      reachable: true,
      discover: () => executionObserverClient.discover(),
      collect: (credential) => executionObserverClient.usage(credential)
    }
  ]
  for (const target of store.getSshTargets()) {
    const connection = connectionManager?.getConnection(target.id)
    const state = connection?.getState()
    const generation = state?.connectionGeneration
    const assertOwner = () => {
      if (
        !connection ||
        connectionManager?.getConnection(target.id) !== connection ||
        connection.getState().status !== 'connected' ||
        connection.getState().connectionGeneration !== generation
      ) {
        throw new Error('SSH execution host is unverifiable')
      }
      return connection
    }
    hosts.push({
      id: toSshExecutionHostId(target.id),
      label: target.label,
      generation: target.generation ?? 0,
      reachable: state?.status === 'connected',
      discover: async () => {
        const result = await executionObserverClient.discover(assertOwner())
        assertOwner()
        return result
      },
      collect: async (credential) => {
        const result = await executionObserverClient.usage(credential, assertOwner())
        assertOwner()
        return result
      }
    })
  }
  return hosts
}
