import {
  managerReceiptParams,
  type ManagerReceiptVerb
} from '../mobile-web-shell/bridge/bridge-manager-receipt-verbs'
import { BridgeNativeVerbRefusedError } from '../mobile-web-shell/bridge-host-errors'
import { managerReceiptOwnerKey, nativeManagerReceiptStore } from './mobile-manager-request-store'

export function createNativeManagerReceiptVerbServer(deps: {
  hostId: string
  readClientIdentity: () => string | null
}) {
  const currentOwner = () => {
    const identity = deps.readClientIdentity()
    if (!identity) {
      throw new BridgeNativeVerbRefusedError(
        'native_verb_out_of_scope',
        'Native pairing is unavailable.'
      )
    }
    return managerReceiptOwnerKey(deps.hostId, identity)
  }
  return async (_verb: ManagerReceiptVerb, input: unknown): Promise<unknown> => {
    const params = managerReceiptParams.parse(input)
    const ownerKey = currentOwner()
    const store = nativeManagerReceiptStore(ownerKey)
    const requireOwner = (expected: string) => {
      if (expected !== ownerKey || currentOwner() !== ownerKey) {
        throw new BridgeNativeVerbRefusedError(
          'native_verb_out_of_scope',
          'Manager receipt belongs to another pairing.'
        )
      }
    }
    if (params.operation === 'read') {
      requireOwner(params.ownerKey ?? ownerKey)
      const receipt = await store.read()
      requireOwner(ownerKey)
      return { operation: 'read', ownerKey, receipt }
    }
    if (params.operation === 'save') {
      requireOwner(params.ownerKey)
      await store.save(params.request)
    } else {
      requireOwner(params.ownerKey)
      await store.clear(params.requestId)
    }
    requireOwner(ownerKey)
    return { operation: params.operation, ownerKey, confirmed: true }
  }
}
