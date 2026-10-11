// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { NotificationRuleEditor } from './NotificationRuleEditor'
import type { NotificationScopePolicy } from '../../../../shared/notification-scope-policy'
import type { NotificationPolicyTarget } from '../../../../shared/notification-policy-target'

const target: NotificationPolicyTarget = {
  label: 'Aurora',
  selector: { level: 'project', id: 'aurora' },
  scope: { projectId: 'aurora' }
}
const policy: NotificationScopePolicy = {
  rules: [],
  deviceOverrides: [{ deviceId: 'phone', muted: true }]
}
afterEach(() => vi.unstubAllGlobals())
it.each([
  ['Silent', 'silent'],
  ['One-minute digest', 'digest']
] as const)(
  'saves %s independently of inherited eligibility and previews it',
  async (label, delivery) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    const root = createRoot(container)
    const save = vi.fn(async (_next: NotificationScopePolicy) => undefined)
    try {
      await act(async () =>
        root.render(
          <NotificationRuleEditor
            policy={policy}
            target={target}
            actor="any"
            destination="desktop"
            save={save}
          />
        )
      )
      const button = (label: string) =>
        [...container.querySelectorAll<HTMLButtonElement>('button')].find(
          (row) => row.textContent === label
        )
      await act(async () => button(label)?.click())
      expect(container.textContent).toContain(`delivery: ${delivery}`)
      await act(async () => button('Save rule')?.click())
      expect(save.mock.calls[0]?.[0].rules[0]?.human).toMatchObject({
        mode: 'inherit',
        delivery,
        destinations: ['desktop']
      })
      expect(save.mock.calls[0]?.[0].deviceOverrides).toEqual(policy.deviceOverrides)
    } finally {
      await act(async () => root.unmount())
    }
  }
)
it('serializes saves, preserves device policy and shows a save failure without claiming success', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  let rejectSave: (error: Error) => void = () => undefined
  const save = vi.fn(
    (_next: NotificationScopePolicy) =>
      new Promise<void>((_resolve, reject) => {
        rejectSave = reject
      })
  )
  try {
    await act(async () =>
      root.render(
        <NotificationRuleEditor
          policy={policy}
          target={target}
          actor="any"
          destination="mobile"
          save={save}
        />
      )
    )
    const submit = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Save rule'
    )
    await act(async () => submit?.click())
    expect(submit?.disabled).toBe(true)
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0]?.[0]).toMatchObject({ deviceOverrides: policy.deviceOverrides })
    await act(async () => rejectSave(new Error('Transport unavailable')))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Transport unavailable')
    expect(submit?.disabled).toBe(false)
    expect(container.textContent).not.toContain('saved successfully')
  } finally {
    await act(async () => root.unmount())
  }
})
