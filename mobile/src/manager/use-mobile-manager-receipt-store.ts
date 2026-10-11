import { useMemo } from 'react'
import { managerReceiptOwnerKey, nativeManagerReceiptStore } from './mobile-manager-request-store'
import type { MobileManagerReceiptBinding } from './mobile-manager-receipt-store-contract'

export function useMobileManagerReceiptStore(
  hostId: string,
  clientId: string | null
): MobileManagerReceiptBinding {
  return useMemo(() => {
    if (!hostId || !clientId) {
      return { store: null, error: null }
    }
    try {
      return {
        store: nativeManagerReceiptStore(managerReceiptOwnerKey(hostId, clientId)),
        error: null
      }
    } catch (cause) {
      return {
        store: null,
        error: cause instanceof Error ? cause.message : 'Native pairing is required.'
      }
    }
  }, [hostId, clientId])
}
