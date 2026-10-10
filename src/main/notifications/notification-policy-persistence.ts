import { createHash } from 'node:crypto'
import type { RuntimeStore } from '../runtime/runtime-store-contract'
import { getDefaultNotificationSettings } from '../../shared/notification-settings-defaults'
import {
  NotificationScopePolicySchema,
  type NotificationScopePolicy
} from '../../shared/notification-scope-policy'

type PolicyStore = Pick<RuntimeStore, 'getSettings' | 'updateSettings' | 'flushOrThrow'>
export function readNotificationPolicy(store: PolicyStore) {
  const policy = store.getSettings().notifications?.scopePolicy ?? {
    rules: [],
    deviceOverrides: []
  }
  return { policy, revision: createHash('sha256').update(JSON.stringify(policy)).digest('hex') }
}

export function writeNotificationPolicy(
  store: PolicyStore,
  policy: NotificationScopePolicy,
  expectedRevision: string
) {
  if (!store.updateSettings) {
    throw new Error('Notification settings are not writable on this runtime')
  }
  const before = readNotificationPolicy(store)
  if (before.revision !== expectedRevision) {
    throw new Error('Notification policy changed elsewhere. Refresh scopes before saving again.')
  }
  const parsed = NotificationScopePolicySchema.parse(policy)
  const notifications = store.getSettings().notifications ?? getDefaultNotificationSettings()
  store.updateSettings({ notifications: { ...notifications, scopePolicy: parsed } })
  store.flushOrThrow?.()
  const result = readNotificationPolicy(store)
  if (JSON.stringify(result.policy) !== JSON.stringify(parsed)) {
    throw new Error('Notification policy was not persisted')
  }
  return result
}
