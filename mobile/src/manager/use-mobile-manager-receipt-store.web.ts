import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { usePageBridgeClientIfPresent } from '../transport/client-context.web'
import { pageManagerReceiptStore } from './page-manager-receipt-store'
import type { MobileManagerReceiptBinding } from './mobile-manager-receipt-store-contract'

export function useMobileManagerReceiptStore(
  hostId: string,
  _clientId: string | null
): MobileManagerReceiptBinding {
  const client = usePageBridgeClientIfPresent()
  const subscribe = useCallback(
    (changed: () => void) => client?.onStateChange(changed) ?? (() => {}),
    [client]
  )
  const snapshot = useCallback(() => client?.getGeneration?.(), [client])
  const generation = useSyncExternalStore(subscribe, snapshot, snapshot)
  const [binding, setBinding] = useState<
    | (MobileManagerReceiptBinding & {
        hostId: string
        client: typeof client
        generation: typeof generation
      })
    | null
  >(null)
  useEffect(() => {
    let canceled = false
    if (client && hostId) {
      void pageManagerReceiptStore(client, hostId)
        .then((store) => {
          if (!canceled) {
            setBinding({ store, error: null, hostId, client, generation })
          }
        })
        .catch((cause: unknown) => {
          if (!canceled) {
            setBinding({
              store: null,
              error: cause instanceof Error ? cause.message : 'Manager recovery is unavailable.',
              hostId,
              client,
              generation
            })
          }
        })
    }
    return () => {
      canceled = true
    }
  }, [client, hostId, generation])
  if (
    binding?.client === client &&
    binding.hostId === hostId &&
    binding.generation === generation
  ) {
    return binding
  }
  return { store: null, error: client ? null : 'Open Manager inside a paired Orca mobile app.' }
}
