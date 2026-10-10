import { useCallback, useSyncExternalStore } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { mobileManagerConnectionKey } from './mobile-manager-call'

export function useMobileManagerConnectionKey(
  client: RpcClient | null,
  ownerKey: string | null
): string {
  const subscribe = useCallback(
    (changed: () => void) => client?.onStateChange(changed) ?? (() => {}),
    [client]
  )
  const snapshot = useCallback(
    () => (client && ownerKey ? mobileManagerConnectionKey(client, ownerKey) : 'unpaired'),
    [client, ownerKey]
  )
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
