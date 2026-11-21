import { describe, expect, it } from 'vitest'
import {
  resolveNotificationScopePolicy,
  normalizeNotificationScopePolicy,
  type NotificationScopePolicy
} from './notification-scope-policy'

const scope = {
  projectId: 'aurora',
  sessionId: 's',
  sessionGeneration: 'one',
  actor: 'root' as const
}
const policy: NotificationScopePolicy = {
  rules: [
    { id: 'quiet', selector: { level: 'server' }, human: { mode: 'inherit', delivery: 'silent' } },
    {
      id: 'project',
      selector: { level: 'project', id: 'aurora' },
      human: { mode: 'selected', events: ['question'] }
    },
    {
      id: 'session',
      selector: { level: 'session', id: 's', generation: 'one' },
      human: { mode: 'inherit', delivery: 'immediate', destinations: ['mobile'] }
    }
  ],
  deviceOverrides: [
    { deviceId: 'quiet-phone', silent: true },
    { deviceId: 'muted-phone', silent: false, muted: true }
  ]
}
describe('silent policy is independent of eligibility and supervision', () => {
  it('preserves legacy immediate delivery and validates additive settings', () => {
    expect(resolveNotificationScopePolicy(undefined, scope, 'question', 'mobile').delivery).toBe(
      'immediate'
    )
    expect(normalizeNotificationScopePolicy(policy)).toEqual(policy)
    expect(
      normalizeNotificationScopePolicy({
        ...policy,
        deviceOverrides: [{ deviceId: 'phone', silent: 'false' }]
      })
    ).toBeUndefined()
  })
  it.each([
    'completion',
    'failure',
    'question',
    'permission',
    'contact-lost',
    'contact-restored',
    'progress',
    'bell',
    'test'
  ] as const)('does not unmute %s or change manager subscriptions', (kind) => {
    const result = resolveNotificationScopePolicy(policy, scope, kind, 'desktop')
    expect(result).toMatchObject({
      human: kind === 'question',
      manager: true,
      delivery: 'silent',
      humanRuleId: 'project',
      deliveryRuleId: 'quiet'
    })
  })
  it('resolves sound inheritance separately, including destination and generation fences', () => {
    expect(resolveNotificationScopePolicy(policy, scope, 'question', 'mobile')).toMatchObject({
      delivery: 'immediate',
      deliveryRuleId: 'session'
    })
    expect(
      resolveNotificationScopePolicy(
        policy,
        { ...scope, sessionGeneration: 'two' },
        'question',
        'mobile'
      )
    ).toMatchObject({ delivery: 'silent', deliveryRuleId: 'quiet' })
  })
  it('device silence is a final veto and false cannot unmute a server or device rule', () => {
    expect(
      resolveNotificationScopePolicy(policy, scope, 'question', 'mobile', 'quiet-phone')
    ).toMatchObject({ human: true, manager: true, delivery: 'silent' })
    expect(
      resolveNotificationScopePolicy(policy, scope, 'question', 'desktop', 'muted-phone')
    ).toMatchObject({ human: false, delivery: 'silent', manager: true, deviceVeto: true })
  })
})
