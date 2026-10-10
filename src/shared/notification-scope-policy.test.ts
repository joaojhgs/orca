import { describe, expect, it } from 'vitest'
import {
  resolveNotificationScopePolicy,
  normalizeNotificationScopePolicy,
  type NotificationScopePolicy,
  type NotificationPolicyScope
} from './notification-scope-policy'

const scope: NotificationPolicyScope = {
  executionHostId: 'ssh:worker',
  projectGroupId: 'personal',
  projectId: 'aurora',
  workspaceId: 'aurora::/repo',
  sessionId: 'chat',
  sessionGeneration: 'one',
  actor: 'root'
}
const policy: NotificationScopePolicy = {
  rules: [
    { id: 'default', selector: { level: 'server' }, human: { mode: 'off' } },
    { id: 'group', selector: { level: 'project-group', id: 'personal' }, human: { mode: 'all' } },
    { id: 'project', selector: { level: 'project', id: 'aurora' }, human: { mode: 'off' } },
    {
      id: 'workspace',
      selector: { level: 'workspace', id: 'aurora::/repo', executionHostId: 'ssh:worker' },
      human: { mode: 'selected', events: ['question'] }
    },
    {
      id: 'session',
      selector: { level: 'session', id: 'chat', generation: 'one' },
      human: { mode: 'all' }
    }
  ],
  deviceOverrides: []
}
describe('notification policy independent audiences', () => {
  it('preserves existing defaults without a new policy', () => {
    expect(resolveNotificationScopePolicy(undefined, scope, 'completion', 'mobile')).toMatchObject({
      human: true,
      manager: true,
      deviceVeto: false
    })
  })
  it('uses scope precedence and fences session-specific preferences by generation', () => {
    expect(resolveNotificationScopePolicy(policy, scope, 'completion', 'mobile')).toMatchObject({
      human: true,
      humanRuleId: 'session'
    })
    expect(
      resolveNotificationScopePolicy(
        policy,
        { ...scope, sessionGeneration: 'two' },
        'completion',
        'mobile'
      )
    ).toMatchObject({ human: false, humanRuleId: 'workspace' })
    expect(
      resolveNotificationScopePolicy(
        policy,
        { ...scope, executionHostId: 'ssh:other', sessionGeneration: 'two' },
        'question',
        'mobile'
      )
    ).toMatchObject({ human: false, humanRuleId: 'project' })
  })
  it('human mutes never disable the manager subscription implicitly', () => {
    const value = resolveNotificationScopePolicy(
      { rules: [policy.rules[0]], deviceOverrides: [] },
      scope,
      'question',
      'mobile'
    )
    expect(value).toMatchObject({ human: false, manager: true })
  })
  it('an explicit manager mute does not change human notification eligibility', () => {
    expect(
      resolveNotificationScopePolicy(
        {
          rules: [
            {
              id: 'manager-off',
              selector: { level: 'server' },
              manager: false
            }
          ],
          deviceOverrides: []
        },
        scope,
        'question',
        'mobile'
      )
    ).toMatchObject({ human: true, manager: false })
  })
  it('desktop-only rules leave mobile unaffected and can select event kinds', () => {
    const value: NotificationScopePolicy = {
      rules: [
        {
          id: 'desktop-off',
          selector: { level: 'project', id: 'aurora' },
          human: { mode: 'selected', events: ['failure'], destinations: ['desktop'] }
        }
      ],
      deviceOverrides: []
    }
    expect(resolveNotificationScopePolicy(value, scope, 'completion', 'desktop').human).toBe(false)
    expect(resolveNotificationScopePolicy(value, scope, 'failure', 'desktop').human).toBe(true)
    expect(resolveNotificationScopePolicy(value, scope, 'completion', 'mobile').human).toBe(true)
  })
  it('device preferences are a final veto, never a way to unmute server policy', () => {
    const value = {
      ...policy,
      deviceOverrides: [{ deviceId: 'phone', mutedEvents: ['question' as const] }]
    }
    expect(
      resolveNotificationScopePolicy(value, scope, 'question', 'mobile', 'phone')
    ).toMatchObject({ human: false, manager: true, deviceVeto: true })
    expect(resolveNotificationScopePolicy(value, scope, 'question', 'mobile', 'other').human).toBe(
      true
    )
  })
  it('does not let rules self-wake the manager conversation', () => {
    expect(
      resolveNotificationScopePolicy(
        {
          rules: [{ id: 'override', selector: { level: 'server' }, manager: true }],
          deviceOverrides: []
        },
        { ...scope, actor: 'manager' },
        'completion',
        'mobile'
      ).manager
    ).toBe(false)
  })
  it('rejects invalid persisted policies instead of retaining truthy type-flipped mutes', () => {
    expect(
      normalizeNotificationScopePolicy({
        rules: [],
        deviceOverrides: [{ deviceId: 'phone', muted: 'false' }]
      })
    ).toBeUndefined()
  })
})
