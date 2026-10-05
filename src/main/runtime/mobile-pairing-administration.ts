import type { MobileApi } from '../../preload/api/mobile-api'
import type { OrcaRuntimeRpcServer } from './runtime-rpc'
import { encodeMobilePairingQr, type MobilePairingQrResult } from './mobile-pairing-qr'
import {
  getDefaultPairingAddress,
  getPairingNetworkInterfaces,
  type DefaultRouteInterfaceLookup
} from './pairing-network-interfaces'

export type PairingAdministrationApi = Pick<
  MobileApi,
  | 'listNetworkInterfaces'
  | 'getPairingQR'
  | 'listDevices'
  | 'revokeDevice'
  | 'listRuntimeAccessGrants'
  | 'revokeRuntimeAccess'
  | 'isWebSocketReady'
>

export type MobileQrDependencies = {
  getDefaultRouteInterfaceNames?: DefaultRouteInterfaceLookup
  encodePairingQr?: (pairingUrl: string) => Promise<MobilePairingQrResult>
  advertisedAddress?: string
}

export async function createMobilePairingQr(
  server: OrcaRuntimeRpcServer,
  args: Parameters<MobileApi['getPairingQR']>[0],
  dependencies: MobileQrDependencies = {}
): ReturnType<MobileApi['getPairingQR']> {
  const address =
    args?.address ??
    dependencies.advertisedAddress ??
    (await getDefaultPairingAddress(dependencies.getDefaultRouteInterfaceNames))
  if (!address && args?.connectionMode === 'local-only') {
    return {
      available: false,
      reason: 'invalid_advertised_endpoint',
      guidance:
        'No reachable network address is available for pairing. Connect to Wi‑Fi or Tailscale, or pick an address manually.'
    }
  }
  const offer = await server.createMobilePairingOffer({
    address,
    connectionMode: args?.connectionMode,
    rotate: args?.rotate,
    name: `Mobile ${new Date().toLocaleDateString()}`
  })
  if (!offer.available) {
    return offer
  }
  const qr = await (dependencies.encodePairingQr ?? encodeMobilePairingQr)(offer.pairingUrl)
  return {
    available: true,
    qrDataUrl: qr.ok ? qr.qrDataUrl : null,
    qrSize: qr.ok ? qr.qrSize : null,
    ...(!qr.ok ? { qrError: qr.reason } : {}),
    pairingUrl: offer.pairingUrl,
    endpoint: address ? offer.endpoint : null,
    deviceId: offer.deviceId,
    connectionMode: offer.connectionMode
  }
}

export function createPairingAdministration(
  server: OrcaRuntimeRpcServer,
  advertisedAddress?: string
): PairingAdministrationApi {
  return {
    listNetworkInterfaces: async () => ({
      // The operator's reverse-proxy endpoint outranks private VPS NICs.
      interfaces: advertisedAddress
        ? [{ name: 'Server address', address: advertisedAddress, hasDefaultRoute: true }]
        : await getPairingNetworkInterfaces()
    }),
    getPairingQR: (args) => createMobilePairingQr(server, args, { advertisedAddress }),
    listDevices: async () => ({
      devices: (server.getDeviceRegistry()?.listDevices() ?? [])
        .filter((device) => device.scope === 'mobile' && device.lastSeenAt > 0)
        .map(({ deviceId, name, pairedAt, lastSeenAt }) => ({
          deviceId,
          name,
          pairedAt,
          lastSeenAt
        }))
    }),
    revokeDevice: async ({ deviceId }) => ({
      revoked: await server.revokeMobileDevice(deviceId)
    }),
    listRuntimeAccessGrants: async () => ({
      grants: (server.getDeviceRegistry()?.listDevices() ?? [])
        .filter((device) => device.scope === 'runtime')
        .sort((a, b) => b.pairedAt - a.pairedAt)
        .map(({ deviceId, name, pairedAt, lastSeenAt }) => ({
          deviceId,
          name,
          createdAt: pairedAt,
          lastSeenAt: lastSeenAt > 0 ? lastSeenAt : null
        }))
    }),
    revokeRuntimeAccess: async ({ deviceId }) => ({
      revoked: server.revokeRuntimeAccess(deviceId)
    }),
    isWebSocketReady: async () => ({
      ready: server.getWebSocketEndpoint() !== null,
      endpoint: advertisedAddress ?? server.getWebSocketEndpoint()
    })
  }
}
