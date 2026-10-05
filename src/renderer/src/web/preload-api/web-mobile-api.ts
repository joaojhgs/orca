import type { PreloadApi } from '../../../../preload/api-types'
import type { MobileApi } from '../../../../preload/api/mobile-api'
import { callRuntimeResult, getRemoteRuntimeStatus } from './web-runtime-calls'
import { noopUnsubscribe } from './web-storage'

type PairingMethod =
  | 'listNetworkInterfaces'
  | 'getPairingQR'
  | 'listDevices'
  | 'revokeDevice'
  | 'listRuntimeAccessGrants'
  | 'revokeRuntimeAccess'
  | 'isWebSocketReady'

async function pairingCall<TKey extends PairingMethod>(
  method: TKey,
  params?: unknown
): Promise<Awaited<ReturnType<MobileApi[TKey]>>> {
  const status = await getRemoteRuntimeStatus()
  if (!status.capabilities?.includes('pairing.administration.v1')) {
    throw new Error('Update the Orca server to manage phone pairing from this browser.')
  }
  return await callRuntimeResult<Awaited<ReturnType<MobileApi[TKey]>>>(
    `pairing.admin.${method}`,
    params
  )
}

export function createWebMobileApi(): Partial<PreloadApi> {
  return {
    mobile: {
      listNetworkInterfaces: () => pairingCall('listNetworkInterfaces'),
      getPairingQR: (args) => pairingCall('getPairingQR', args ?? {}),
      getWindowsFirewallStatus: () => Promise.resolve({ supported: false }),
      repairWindowsFirewall: () => Promise.resolve({ ok: false, reason: 'unsupported' }),
      openWindowsNetworkSettings: () => Promise.resolve(false),
      getRuntimePairingUrl: () => Promise.resolve({ available: false }),
      listDevices: () => pairingCall('listDevices'),
      revokeDevice: (args) => pairingCall('revokeDevice', args),
      listRuntimeAccessGrants: () => pairingCall('listRuntimeAccessGrants'),
      revokeRuntimeAccess: (args) => pairingCall('revokeRuntimeAccess', args),
      isWebSocketReady: () => pairingCall('isWebSocketReady'),
      getRelayStatus: () => Promise.resolve({ status: 'offline' as const }),
      onRelayStatusChanged: () => noopUnsubscribe,
      consumePendingUnpairedDeviceAuthFailure: () => Promise.resolve(false),
      onUnpairedDeviceAuthFailure: () => noopUnsubscribe
    }
  }
}
