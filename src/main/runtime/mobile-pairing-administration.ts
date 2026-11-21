import { requestMobilePairingOffer } from './rpc/server/pairing/pairing-offer-requests'
import { MOBILE_PAIRING_OFFER_TTL_MS } from './rpc/server/pairing/pairing-offer-expiry'
import type { MobileApi } from '../../preload/api/mobile/mobile-api'
import type { OrcaRuntimeRpcServer } from './rpc/server/runtime-rpc'
import {
  encodeMobilePairingQr,
  type MobilePairingQrResult
} from './rpc/server/pairing/mobile-pairing-qr'
import {
  getPairingNetworkInterfaces,
  type DefaultRouteInterfaceLookup
} from './rpc/server/pairing/network/pairing-network-interfaces'

export type PairingAdministrationApi = Pick<
  MobileApi,
  | 'listNetworkInterfaces'
  | 'getPairingQR'
  | 'listDevices'
  | 'revokeDevice'
  | 'listRuntimeAccessGrants'
  | 'revokeRuntimeAccess'
> & { isWebSocketReady(): Promise<{ ready: boolean; endpoint: string | null }> }

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
  const offer = await requestMobilePairingOffer(
    server,
    {
      ...args,
      address: args?.address ?? dependencies.advertisedAddress,
      offerTtlMs: MOBILE_PAIRING_OFFER_TTL_MS
    },
    dependencies.getDefaultRouteInterfaceNames
  )
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
    endpoint: offer.endpoint,
    deviceId: offer.deviceId,
    connectionMode: offer.connectionMode,
    expiresAt: offer.offerExpiresAt
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
        : await getPairingNetworkInterfaces(server.getNetworkExposureBindHost())
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
