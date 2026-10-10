import { describe, expect, it } from 'vitest'
import {
  RuntimeMobileNotificationController,
  type MobileNotificationDispatchEvent
} from './runtime-mobile-notification-controller'
import type { NotificationScopePolicy } from '../../shared/notification-scope-policy'
import {
  normalizeNotificationSettings,
  persistedNotificationSettingsRepaired
} from '../persistence/applying-settings/onboarding-normalization'
import { getDefaultNotificationSettings } from '../../shared/notification-settings-defaults'

const event: MobileNotificationDispatchEvent = {
  type: 'notification',
  source: 'agent-task-complete',
  agentState: 'done',
  title: 'done',
  body: '',
  notificationScope: { projectId: 'aurora', executionHostId: 'ssh:worker' }
}
const mute: NotificationScopePolicy = {
  rules: [
    { id: 'quiet-aurora', selector: { level: 'project', id: 'aurora' }, human: { mode: 'off' } }
  ],
  deviceOverrides: []
}
describe('notification scope persistence and delivery', () => {
  it('persists a valid scope policy without repeated normalization repairs', () => {
    const persisted = { ...getDefaultNotificationSettings(), scopePolicy: mute }
    const normalized = normalizeNotificationSettings(persisted)
    expect(normalized.scopePolicy).toEqual(mute)
    expect(persistedNotificationSettingsRepaired(persisted, normalized)).toBe(false)
  })
  it('marks an invalid policy for repair rather than silently retaining it on disk', () => {
    const persisted = { ...getDefaultNotificationSettings(), scopePolicy: { rules: 'broken' } }
    expect(
      persistedNotificationSettingsRepaired(persisted, normalizeNotificationSettings(persisted))
    ).toBe(true)
  })
  it('does not fan out or retain an event muted by project policy', () => {
    const controller = new RuntimeMobileNotificationController()
    controller.configurePolicy({ read: () => mute, scope: (row) => row.notificationScope ?? {} })
    const seen: unknown[] = []
    controller.onDispatched((row) => seen.push(row))
    controller.dispatch(event)
    expect(seen).toEqual([])
    expect(controller.getMissedSince(0)).toEqual([])
  })
  it('re-evaluates policy for historical events and applies final per-device veto', () => {
    let policy: NotificationScopePolicy | undefined
    const controller = new RuntimeMobileNotificationController()
    controller.configurePolicy({ read: () => policy, scope: (row) => row.notificationScope ?? {} })
    controller.dispatch(event)
    const recorded = controller.getMissedSince(0)[0]
    policy = mute
    expect(controller.allowsDelivery(recorded, 'phone')).toBe(false)
    policy = { rules: [], deviceOverrides: [{ deviceId: 'phone', muted: true }] }
    expect(controller.allowsDelivery(recorded, 'phone')).toBe(false)
    expect(controller.allowsDelivery(recorded, 'other')).toBe(true)
    expect(controller.allowsDelivery({ type: 'dismiss', notificationId: 'old' }, 'phone')).toBe(
      true
    )
  })
  it('desktop-only mutes preserve mobile delivery', () => {
    const controller = new RuntimeMobileNotificationController()
    controller.configurePolicy({
      read: () => ({
        ...mute,
        rules: [{ ...mute.rules[0], human: { mode: 'off', destinations: ['desktop'] } }]
      }),
      scope: (row) => row.notificationScope ?? {}
    })
    controller.dispatch(event)
    expect(controller.getMissedSince(0)).toHaveLength(1)
  })
  it('mobile-only mutes preserve desktop streams without allowing mobile push', () => {
    const controller = new RuntimeMobileNotificationController()
    controller.configurePolicy({
      read: () => ({
        ...mute,
        rules: [{ ...mute.rules[0], human: { mode: 'off', destinations: ['mobile'] } }]
      }),
      scope: (row) => row.notificationScope ?? {}
    })
    controller.dispatch(event)
    const recorded = controller.getMissedSince(0)[0]
    expect(recorded).toBeDefined()
    expect(controller.allowsDelivery(recorded, 'phone')).toBe(false)
    expect(controller.allowsDelivery(recorded, 'desktop', 'desktop')).toBe(true)
  })
})
