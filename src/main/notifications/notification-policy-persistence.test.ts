import { expect, it, vi } from 'vitest'
import { createGlobalSettingsFixture } from '../../shared/global-settings-test-fixture'
import { readNotificationPolicy, writeNotificationPolicy } from './notification-policy-persistence'
import type { GlobalSettings } from '../../shared/global-settings-types'

it('persists server policy without changing ordinary notification preferences and fences stale editors', () => {
  let settings = createGlobalSettingsFixture()
  const updateSettings = vi.fn((updates: Partial<GlobalSettings>) => {
    settings = { ...settings, ...updates }
  })
  const store = { getSettings: () => settings, updateSettings }
  const first = readNotificationPolicy(store)
  const notifications = settings.notifications
  const policy = {
    rules: [
      { id: 'human-off', selector: { level: 'server' as const }, human: { mode: 'off' as const } }
    ],
    deviceOverrides: []
  }
  const saved = writeNotificationPolicy(store, policy, first.revision)
  expect(saved.policy).toEqual(policy)
  expect(settings.notifications).toEqual({ ...notifications, scopePolicy: policy })
  expect(() =>
    writeNotificationPolicy(store, { rules: [], deviceOverrides: [] }, first.revision)
  ).toThrow('changed elsewhere')
  expect(updateSettings).toHaveBeenCalledOnce()
  expect(readNotificationPolicy(store)).toEqual(saved)
})
it('does not claim persistence when a runtime has no settings writer', () => {
  const store = { getSettings: () => createGlobalSettingsFixture() }
  expect(() =>
    writeNotificationPolicy(
      store,
      { rules: [], deviceOverrides: [] },
      readNotificationPolicy(store).revision
    )
  ).toThrow('not writable')
})
it('propagates a durable storage failure instead of acknowledging an in-memory policy', () => {
  let settings = createGlobalSettingsFixture()
  const flushOrThrow = vi.fn(() => {
    throw new Error('disk unavailable')
  })
  const store = {
    getSettings: () => settings,
    updateSettings: (updates: Partial<GlobalSettings>) => {
      settings = { ...settings, ...updates }
    },
    flushOrThrow
  }
  expect(() =>
    writeNotificationPolicy(
      store,
      { rules: [], deviceOverrides: [] },
      readNotificationPolicy(store).revision
    )
  ).toThrow('disk unavailable')
  expect(flushOrThrow).toHaveBeenCalledOnce()
})
