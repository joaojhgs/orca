import { expect, it, vi } from 'vitest'
import { PushDispatcher } from './push-dispatcher'
import { RuntimeMobileNotificationController } from '../runtime-mobile-notification-controller'
import type { PushGatewayClient } from './push-gateway-client'
import { registration, notification, flush, type SendCall } from './push-dispatcher.test-fixture'
import type { NotificationScopePolicy } from '../../../shared/notification-scope-policy'

function harness(initial: NotificationScopePolicy, unreachable = false) {
  let policy = initial
  const controller = new RuntimeMobileNotificationController()
  controller.configurePolicy({
    read: () => policy,
    scope: (event) => event.notificationScope ?? {}
  })
  const sends: SendCall[] = []
  const retries: (() => void)[] = []
  const devices = ['a', 'b', 'c'].map((deviceId) => ({
    deviceId,
    pushRegistration: registration({
      registrationId: deviceId,
      filter: deviceId === 'c' ? { sound: false } : {}
    })
  }))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the dispatcher only calls send; the real gateway is intentionally absent.
  const client = {
    send: vi.fn(async (input: SendCall) => {
      sends.push(input)
      return unreachable ? { ok: false, reason: 'unreachable' } : { ok: true, results: [] }
    })
  } as unknown as PushGatewayClient
  const dispatcher = new PushDispatcher({
    client,
    registry: { listDevices: () => devices, setPushRegistration: () => true },
    allowsDelivery: (event, deviceId) => controller.allowsDelivery(event, deviceId),
    allowsSound: (event, deviceId) => controller.allowsSound(event, deviceId),
    scheduleRetry: (run) => retries.push(run)
  })
  return {
    dispatcher,
    sends,
    retries,
    setPolicy: (next: NotificationScopePolicy) => {
      policy = next
    }
  }
}
it('honors per-device silence and registration sound veto without changing other phones', async () => {
  const h = harness({ rules: [], deviceOverrides: [{ deviceId: 'a', silent: true }] })
  h.dispatcher.enqueue(notification())
  await flush()
  expect(h.sends).toHaveLength(2)
  expect(h.sends.find((entry) => entry.notification.sound === false)?.registrationIds).toEqual([
    'a',
    'c'
  ])
  expect(h.sends.find((entry) => entry.notification.sound !== false)?.registrationIds).toEqual([
    'b'
  ])
})
it('silences an eligible headless event by scope without emitting a new gateway field', async () => {
  const h = harness({
    rules: [
      { id: 'quiet', selector: { level: 'server' }, human: { mode: 'inherit', delivery: 'silent' } }
    ],
    deviceOverrides: []
  })
  h.dispatcher.enqueue(notification())
  await flush()
  expect(h.sends).toHaveLength(1)
  expect(h.sends[0]?.notification.sound).toBe(false)
  expect(h.sends[0]?.registrationIds).toEqual(['a', 'b', 'c'])
})
it('rechecks tightened silence and final device mute before a transport retry', async () => {
  const h = harness({ rules: [], deviceOverrides: [] }, true)
  h.dispatcher.enqueue(notification())
  await flush()
  const before = h.sends.length
  h.setPolicy({
    rules: [],
    deviceOverrides: [
      { deviceId: 'a', silent: true },
      { deviceId: 'b', muted: true }
    ]
  })
  h.retries.splice(0).forEach((retry) => retry())
  await flush()
  const retried = h.sends.slice(before)
  expect(retried.flatMap((entry) => entry.registrationIds).sort()).toEqual(['a', 'c'])
  expect(retried.every((entry) => entry.notification.sound === false)).toBe(true)
})
it('never makes dismissals audible even when a registration permits sound', async () => {
  const h = harness({ rules: [], deviceOverrides: [] })
  h.dispatcher.enqueue({
    type: 'dismiss',
    notificationId: 'old',
    notificationSeq: 8,
    notificationEpoch: 'epoch'
  })
  await flush()
  expect(h.sends).toHaveLength(1)
  expect(h.sends[0]?.notification.sound).toBe(false)
})
