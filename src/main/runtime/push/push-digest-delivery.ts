import { join } from 'node:path'
import type { MobileNotificationEvent } from '../runtime-mobile-notification-controller'
import type { PushDispatcherRegistry, PushDispatcher } from './push-dispatcher'
import { allowsPushDelivery, mapPushAgentState } from './push-dispatcher'
import { NotificationDigestQueue } from '../../notifications/notification-digest-queue'
import type { PushDigestPayload } from '../../notifications/notification-digest-payload'
import {
  PushDigestPayloadSchema,
  notificationDigestBody,
  notificationDigestKey
} from '../../notifications/notification-digest-payload'

export class PushDigestDelivery {
  private readonly queue: NotificationDigestQueue<PushDigestPayload> | null
  constructor(
    private readonly options: {
      userDataPath?: string
      registry: PushDispatcherRegistry
      dispatcher: PushDispatcher
      allowsDelivery(event: MobileNotificationEvent, deviceId: string): boolean
      deliveryMode(
        event: MobileNotificationEvent,
        deviceId: string
      ): 'immediate' | 'silent' | 'digest'
      confirmRelevant?(event: MobileNotificationEvent): Promise<boolean | null>
    }
  ) {
    this.queue = options.userDataPath
      ? new NotificationDigestQueue(
          join(options.userDataPath, 'mobile-notification-digests.json'),
          PushDigestPayloadSchema
        )
      : null
  }

  start(): void {
    this.queue?.start(async (items, isPending) => {
      const allowed: PushDigestPayload[] = []
      for (const item of items) {
        const registration = this.options.registry
          .listDevices()
          .find((device) => device.deviceId === item.deviceId)?.pushRegistration
        if (
          !registration ||
          registration.registrationId !== item.registrationId ||
          registration.expiresAt <= Date.now() ||
          !this.options.allowsDelivery(item.event, item.deviceId) ||
          !allowsPushDelivery(registration, item.event)
        ) {
          continue
        }
        const relevant = await this.options.confirmRelevant?.(item.event)
        if (relevant === null) {
          return false
        }
        if (
          relevant !== false &&
          isPending(item) &&
          this.options.allowsDelivery(item.event, item.deviceId)
        ) {
          allowed.push(item)
        }
      }
      const current = allowed.filter((item) => {
        const registration = this.options.registry
          .listDevices()
          .find((device) => device.deviceId === item.deviceId)?.pushRegistration
        return (
          isPending(item) &&
          registration?.registrationId === item.registrationId &&
          this.options.allowsDelivery(item.event, item.deviceId)
        )
      })
      const latest = current.at(-1)
      if (latest) {
        this.options.dispatcher.enqueue(
          { ...latest.event, body: notificationDigestBody(current.length, latest.event.body) },
          new Set([latest.deviceId]),
          true
        )
      }
      // Accepted into the existing dispatcher, not confirmed OS/provider delivery.
      return true
    })
  }

  stop(): void {
    this.queue?.stop()
  }

  enqueue(event: MobileNotificationEvent): void {
    if (event.type === 'dismiss') {
      try {
        this.queue?.cancel(
          (item) =>
            item.event.notificationId === event.notificationId &&
            (!event.dismissedDelivery ||
              (item.event.notificationEpoch === event.dismissedDelivery.notificationEpoch &&
                item.event.notificationSeq <= event.dismissedDelivery.notificationSeq))
        )
      } catch {
        console.warn('[notifications] Digest dismissal could not be persisted')
      }
      this.options.dispatcher.enqueue(event)
      return
    }
    if (mapPushAgentState(event.source, event.agentState) === undefined) {
      return
    }
    const immediate = new Set<string>()
    for (const device of this.options.registry.listDevices()) {
      const registration = device.pushRegistration
      if (
        !registration ||
        registration.expiresAt <= Date.now() ||
        !this.options.allowsDelivery(event, device.deviceId) ||
        !allowsPushDelivery(registration, event)
      ) {
        continue
      }
      if (this.options.deliveryMode(event, device.deviceId) !== 'digest') {
        immediate.add(device.deviceId)
        continue
      }
      const parsed = PushDigestPayloadSchema.safeParse({
        deviceId: device.deviceId,
        registrationId: registration.registrationId,
        event
      })
      const accepted =
        parsed.success &&
        this.queue?.enqueue(
          notificationDigestKey(
            event.notificationScope ?? {},
            event.notificationKind ?? event.agentState ?? event.source,
            JSON.stringify([device.deviceId, registration.registrationId])
          ),
          JSON.stringify([event.notificationEpoch, event.notificationSeq]),
          parsed.data
        )
      if (!accepted) {
        console.warn('[notifications] Mobile digest was not queued; storage is unavailable or full')
      }
    }
    if (immediate.size) {
      this.options.dispatcher.enqueue(event, immediate)
    }
  }
}
