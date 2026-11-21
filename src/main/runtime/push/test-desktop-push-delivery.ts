import { randomUUID } from 'node:crypto'
import type { MobilePushTestResult } from '../../../shared/notifications/mobile-push-contract'
import type { PushGatewayClient } from './push-gateway-client'
import type { DeviceRegistry } from '../rpc/server/pairing/device-registry'
type PushDeviceRegistration = NonNullable<
  NonNullable<ReturnType<DeviceRegistry['getDevice']>>['pushRegistration']
>
export async function testDesktopPushDelivery(
  client: Pick<PushGatewayClient, 'send'>,
  registration: PushDeviceRegistration
): Promise<MobilePushTestResult> {
  // Explicit tests target only the caller and bypass automatic activity filters.
  const result = await client.send({
    registrationIds: [registration.registrationId],
    notification: {
      source: 'terminal-bell',
      agentState: null,
      title: 'Test notification',
      body: '',
      notificationId: randomUUID(),
      notificationEpoch: randomUUID(),
      notificationSeq: 0,
      expiresAt: Date.now() + 300_000,
      sound: registration.filter.sound !== false
    }
  })
  if (!result.ok) {
    return {
      accepted: false,
      reason: result.reason === 'unreachable' ? 'unavailable' : 'rejected'
    }
  }
  const status = result.results.find(
    (entry) => entry.registrationId === registration.registrationId
  )?.status
  if (status === 'queued') {
    return { accepted: true }
  }
  return {
    accepted: false,
    reason:
      status === 'rate_limited' ? 'rate_limited' : status === 'dead' ? 'not_registered' : 'rejected'
  }
}
