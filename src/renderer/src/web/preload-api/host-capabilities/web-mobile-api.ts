import type { MobileApi } from '../../../../../preload/api/mobile/mobile-api'
import type { RuntimeStatus } from '../../../../../shared/remote-runtime/session-graph/runtime-session-contracts'
import { unwrapRuntimeRpcResult } from '../../../runtime/rpc/calls/runtime-rpc-result'
import { callEnvironmentEnvelope } from '../../runtime/client/web-runtime-calls'
import {
  assertActiveEnvironment,
  requireActiveEnvironment
} from '../../runtime/client/web-runtime-session'
import { noopUnsubscribe } from '../web-storage'

type WebPairingApi = MobileApi & {
  isWebSocketReady: () => Promise<{ ready: boolean; endpoint: string | null }>
}

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
): Promise<Awaited<ReturnType<WebPairingApi[TKey]>>> {
  const owner = requireActiveEnvironment()
  const pairingRevision = owner.pairingRevision ?? owner.createdAt
  const status = unwrapRuntimeRpcResult(
    await callEnvironmentEnvelope<RuntimeStatus>(
      owner.id,
      'status.get',
      undefined,
      15_000,
      pairingRevision
    )
  )
  if (!status.capabilities?.includes('pairing.administration.v1')) {
    throw new Error('Update the Orca server to manage phone pairing from this browser.')
  }
  assertActiveEnvironment(owner.id)
  return unwrapRuntimeRpcResult(
    await callEnvironmentEnvelope<Awaited<ReturnType<WebPairingApi[TKey]>>>(
      owner.id,
      `pairing.admin.${method}`,
      params,
      undefined,
      pairingRevision,
      status.runtimeId
    )
  )
}

export function createWebMobileApi(): { mobile: WebPairingApi } {
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
