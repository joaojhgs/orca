import { processDeviceStore } from '../../device-store/device-store'
import { useNativeImageActions } from '../../platform/image-actions/native-image-actions'
import { useNativePdfViewer } from '../../platform/pdf-viewing/native-pdf-view'
import { useNativeDeviceVerbs } from '../../platform/use-native-device-verbs'
import type { ManagerReceiptVerb } from '../bridge/bridge-manager-receipt-verbs'
import {
  storageReadParamsSchema,
  type BridgeNativeVerb
} from '../bridge/native-capabilities/bridge-native-verbs'
import { BRIDGE_STORE_VERB } from '../bridge/native-capabilities/bridge-store-verb'
import { serveDeviceStoreVerb } from './device-store-verb-server'

export function useShellNativeVerbs(
  hostId: string,
  sessionId: string | null,
  readWorkspaceKey: (key: string) => Promise<string | null>
): (verb: Exclude<BridgeNativeVerb, ManagerReceiptVerb>, params: unknown) => Promise<unknown> {
  const serveDeviceVerb = useNativeDeviceVerbs(sessionId)
  const servePdfView = useNativePdfViewer(hostId, sessionId)
  const serveImageAction = useNativeImageActions(sessionId)

  return (verb, params) =>
    verb === 'native.storage.read'
      ? readWorkspaceKey(storageReadParamsSchema.parse(params).key).then((value) => ({ value }))
      : verb === 'native.pdf.view'
        ? servePdfView(params)
        : verb === 'native.image.act'
          ? serveImageAction(params)
          : verb === BRIDGE_STORE_VERB
            ? serveDeviceStoreVerb(processDeviceStore(), hostId, params)
            : serveDeviceVerb(verb, params)
}
