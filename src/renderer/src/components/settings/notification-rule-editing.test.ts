import { describe, expect, it } from 'vitest'
import { editNotificationRule, findNotificationRule } from './notification-rule-editing'
import type { NotificationScopePolicy } from '../../../../shared/notification-scope-policy'
import type { NotificationPolicyTarget } from '../../../../shared/notification-policy-target'

const target: NotificationPolicyTarget = {
  label: 'Aurora',
  selector: { level: 'project', id: 'aurora' },
  scope: { projectId: 'aurora' }
}
const base: NotificationScopePolicy = {
  rules: [{ id: 'server', selector: { level: 'server' }, manager: true }],
  deviceOverrides: [{ deviceId: 'phone', muted: true }]
}
describe('notification rule editing', () => {
  it('adds an independent human mute without clearing manager or paired-device rules', () => {
    const next = editNotificationRule(base, target, 'any', 'mobile', {
      id: 'new',
      mode: 'off',
      events: [],
      manager: 'inherit'
    })
    expect(next.rules[0]).toEqual(base.rules[0])
    expect(next.deviceOverrides).toEqual(base.deviceOverrides)
    expect(findNotificationRule(next, target, 'any', 'mobile')).toEqual({
      id: 'new',
      selector: target.selector,
      human: { mode: 'off', destinations: ['mobile'] }
    })
  })
  it('updates the same override without duplicate identities or changing another destination', () => {
    const first = editNotificationRule(base, target, 'root', 'mobile', {
      id: 'mobile',
      mode: 'selected',
      events: ['failure'],
      manager: 'on'
    })
    const desktop = editNotificationRule(first, target, 'root', 'desktop', {
      id: 'desktop',
      mode: 'all',
      events: [],
      manager: 'inherit'
    })
    const changed = editNotificationRule(desktop, target, 'root', 'mobile', {
      id: 'ignored',
      mode: 'off',
      events: [],
      manager: 'inherit'
    })
    expect(changed.rules.map((rule) => rule.id)).toEqual(['server', 'desktop', 'mobile'])
    expect(findNotificationRule(changed, target, 'root', 'desktop')?.human?.mode).toBe('all')
    expect(findNotificationRule(changed, target, 'worker', 'mobile')).toBeUndefined()
    expect(findNotificationRule(changed, target, 'root', 'mobile')?.manager).toBeUndefined()
  })
  it('keeps process generations and host-qualified workspace identities distinct', () => {
    const session: NotificationPolicyTarget = {
      label: 'Session',
      selector: { level: 'session', id: 's', generation: 'old' },
      scope: {}
    }
    const next = editNotificationRule(base, session, 'any', 'both', {
      id: 'old-session',
      mode: 'off',
      events: [],
      manager: 'inherit'
    })
    expect(
      findNotificationRule(
        next,
        { ...session, selector: { level: 'session', id: 's', generation: 'new' } },
        'any',
        'both'
      )
    ).toBeUndefined()
  })
})
