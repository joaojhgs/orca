import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PushDigestDelivery } from './push-digest-delivery'
import { createHarness, registration, notification } from './push-dispatcher.test-fixture'
import type { MobileNotificationEvent } from '../runtime-mobile-notification-controller'

const disposers: (() => void)[] = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
  vi.useRealTimers()
})
function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'orca-push-digest-'))
  const devices = ['a', 'b'].map((deviceId) => ({
    deviceId,
    pushRegistration: registration({ registrationId: deviceId })
  }))
  const gateway = createHarness({ devices })
  let muted = false
  let relevant: boolean | null = true
  const create = () =>
    new PushDigestDelivery({
      userDataPath: dir,
      dispatcher: gateway.dispatcher,
      registry: { listDevices: () => devices, setPushRegistration: () => true },
      allowsDelivery: (_event, deviceId) => !muted || deviceId !== 'a',
      deliveryMode: (_event, deviceId) => (deviceId === 'a' ? 'digest' : 'immediate'),
      confirmRelevant: async () => relevant
    })
  let delivery = create()
  delivery.start()
  disposers.push(() => {
    delivery.stop()
    gateway.dispatcher.stop()
    rmSync(dir, { recursive: true, force: true })
  })
  return {
    devices,
    gateway,
    enqueue: (event: MobileNotificationEvent) => delivery.enqueue(event),
    restart: () => {
      delivery.stop()
      delivery = create()
      delivery.start()
    },
    mute: () => {
      muted = true
    },
    relevant: (value: boolean | null) => {
      relevant = value
    }
  }
}
it('delivers to an immediate phone and a separate durable digest phone across restart', async () => {
  const h = harness()
  h.enqueue(notification({ notificationId: 'one', notificationSeq: 1 }))
  h.enqueue(notification({ notificationId: 'two', notificationSeq: 2 }))
  expect(h.gateway.sends.map((send) => send.registrationIds)).toEqual([['b'], ['b']])
  h.restart()
  await vi.advanceTimersByTimeAsync(60_000)
  const digests = h.gateway.sends.filter((send) => send.registrationIds.includes('a'))
  expect(digests).toHaveLength(1)
  expect(digests[0]?.notification.body).toContain('2 eligible alerts recorded')
  expect(digests[0]?.notification.sound).toBe(false)
  expect(digests[0]?.notification.notificationSeq).toBe(2)
})
it('rechecks device policy and registration identity at handoff', async () => {
  const h = harness()
  h.enqueue(notification())
  h.mute()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(h.gateway.sends.every((send) => !send.registrationIds.includes('a'))).toBe(true)
})
it('does not deliver old digests to a rotated registration', async () => {
  const h = harness()
  h.enqueue(notification())
  h.devices[0].pushRegistration = registration({ registrationId: 'new' })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(h.gateway.sends.every((send) => !send.registrationIds.includes('new'))).toBe(true)
})
it('defers unverifiable execution instead of discarding or presenting it as completion', async () => {
  const h = harness()
  h.enqueue(notification())
  h.relevant(null)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(h.gateway.sends).toHaveLength(1)
  h.restart()
  h.relevant(true)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(h.gateway.sends).toHaveLength(2)
  expect(h.gateway.sends[1]?.registrationIds).toEqual(['a'])
})
it('retires answered or resumed-source notifications before the digest', async () => {
  const h = harness()
  h.enqueue(notification())
  h.relevant(false)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(h.gateway.sends).toHaveLength(1)
})
it('cancels a queued delivery while still forwarding the original silent dismissal', async () => {
  const h = harness()
  h.enqueue(notification())
  h.enqueue({
    type: 'dismiss',
    notificationId: 'agent:one',
    notificationSeq: 8,
    notificationEpoch: 'epoch-1'
  })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(h.gateway.sends).toHaveLength(2)
  expect(h.gateway.sends[1]?.notification).toMatchObject({ kind: 'dismiss', sound: false })
})
it('never queues working events as future completion alerts', async () => {
  const h = harness()
  h.enqueue(notification({ agentState: 'working' }))
  await vi.advanceTimersByTimeAsync(120_000)
  expect(h.gateway.sends).toEqual([])
})
