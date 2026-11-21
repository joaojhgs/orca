import type { BridgeRpcClient } from '../mobile-web-shell/bridge/bridge-rpc-client'
import {
  MANAGER_RECEIPT_VERBS,
  managerReceiptReadResult,
  managerReceiptMutationResult,
  managerReceiptSaveParams,
  managerReceiptClearParams
} from '../mobile-web-shell/bridge/bridge-manager-receipt-verbs'
import type { MobileManagerReceiptStore } from './mobile-manager-receipt-store-contract'

export async function pageManagerReceiptStore(
  client: BridgeRpcClient,
  hostId: string
): Promise<MobileManagerReceiptStore> {
  const session = client.getShellSession()
  if (
    session?.host?.id !== hostId ||
    !MANAGER_RECEIPT_VERBS.every((verb) => session.grants.native.includes(verb))
  ) {
    throw new Error(
      'This mobile app cannot safely recover manager requests. Update the app or use the native Manager screen.'
    )
  }
  const generation = client.getGeneration?.()
  const requireCurrent = () => {
    if (
      client.getShellSession()?.sessionId !== session.sessionId ||
      client.getShellSession()?.host?.id !== hostId ||
      client.getGeneration?.() !== generation
    ) {
      throw new Error(
        'Controller connection changed. Reopen Manager and reconcile the saved request.'
      )
    }
  }
  const read = async (expectedOwner?: string) => {
    requireCurrent()
    const result = managerReceiptReadResult.parse(
      (
        await client.callNativeVerb('native.manager.receipt', {
          operation: 'read',
          ...(expectedOwner ? { ownerKey: expectedOwner } : {})
        })
      ).result
    )
    requireCurrent()
    return result
  }
  const { ownerKey } = await read()
  const confirm = (input: unknown, operation: 'save' | 'clear') => {
    requireCurrent()
    const result = managerReceiptMutationResult.parse(input)
    if (result.ownerKey !== ownerKey || result.operation !== operation) {
      throw new Error('Manager receipt pairing changed.')
    }
  }
  return {
    ownerKey,
    read: async () => {
      const result = await read(ownerKey)
      if (result.ownerKey !== ownerKey) {
        throw new Error('Manager receipt pairing changed.')
      }
      return result.receipt
    },
    save: async (request) => {
      requireCurrent()
      const params = managerReceiptSaveParams.parse({ operation: 'save', ownerKey, request })
      confirm((await client.callNativeVerb('native.manager.receipt', params)).result, 'save')
    },
    clear: async (requestId) => {
      requireCurrent()
      const params = managerReceiptClearParams.parse({ operation: 'clear', ownerKey, requestId })
      confirm((await client.callNativeVerb('native.manager.receipt', params)).result, 'clear')
    }
  }
}
