import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { Pressable, Switch, TextInput } from 'react-native'
import { PickerModal } from '../components/PickerModal'
import { PickerListDrawer } from '../components/PickerListDrawer'
import { NotificationPolicyRuleEditor } from './notification-policy-rule-editor'
import { NotificationPolicyDeviceEditor } from './notification-policy-device-editor'
import type { NotificationScopePolicy } from '../../../src/shared/notification-scope-policy'

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  Switch: 'Switch',
  TextInput: 'TextInput',
  StyleSheet: { create: (value: unknown) => value }
}))
vi.mock('expo-crypto', () => ({ randomUUID: () => 'new-rule' }))
vi.mock('../components/PickerModal', () => ({ PickerModal: 'Picker' }))
vi.mock('../components/PickerListDrawer', () => ({ PickerListDrawer: 'ScopePicker' }))
const policy: NotificationScopePolicy = {
  rules: [{ id: 'other', selector: { level: 'project', id: 'other-project' }, manager: true }],
  deviceOverrides: [{ deviceId: 'phone', muted: true }]
}
const targets = [
  {
    label: 'Aurora',
    selector: { level: 'project', id: 'aurora' } as const,
    scope: { projectId: 'aurora' }
  }
]
let renderer: ReactTestRenderer
afterEach(() => act(() => renderer?.unmount()))
const picker = (title: string) =>
  renderer.root.findAllByType(PickerModal).find((row) => row.props.title === title)!
const button = (label: string) =>
  renderer.root.findAllByType(Pressable).find((row) => row.props.accessibilityLabel === label)!

it('saves selected mobile human events and independent manager wake rules without losing unrelated policy', async () => {
  const save = vi.fn(async () => {})
  await act(async () => {
    renderer = create(
      createElement(NotificationPolicyRuleEditor, { policy, targets, busy: false, save })
    )
  })
  await act(async () => {
    picker('Human destination').props.onSelect('mobile')
    picker('Agent').props.onSelect('manager')
  })
  await act(async () => {
    picker('Human alerts').props.onSelect('selected')
    picker('Delivery').props.onSelect('digest')
    picker('Wake manager').props.onSelect('off')
  })
  await act(async () =>
    renderer.root
      .findAllByType(Switch)
      .find((row) => row.props.accessibilityLabel === 'Completion')!
      .props.onValueChange(true)
  )
  await act(async () => button('Save notification rule').props.onPress())
  expect(save).toHaveBeenCalledWith({
    ...policy,
    rules: [
      ...policy.rules,
      {
        id: 'new-rule',
        selector: targets[0].selector,
        actor: 'manager',
        human: {
          mode: 'selected',
          delivery: 'digest',
          events: ['completion'],
          destinations: ['mobile']
        },
        manager: false
      }
    ]
  })
})

it('searches the scope inventory and disables mutations while saving remotely', async () => {
  const save = vi.fn(async () => {})
  await act(async () => {
    renderer = create(
      createElement(NotificationPolicyRuleEditor, { policy, targets, busy: true, save })
    )
  })
  expect(button('Save notification rule').props.disabled).toBe(true)
  expect(renderer.root.findByType(TextInput).props.editable).toBe(false)
  await act(async () => {
    renderer.update(
      createElement(NotificationPolicyRuleEditor, { policy, targets, busy: false, save })
    )
  })
  await act(async () => renderer.root.findByType(TextInput).props.onChangeText('absent'))
  expect(renderer.root.findByType(PickerListDrawer).props.items).toEqual([])
})

it('keeps offline device overrides editable and preserves rules and other device options', async () => {
  const save = vi.fn(async () => {})
  await act(async () => {
    renderer = create(
      createElement(NotificationPolicyDeviceEditor, { policy, devices: [], busy: false, save })
    )
  })
  await act(async () => button('Device notification overrides').props.onPress())
  expect(JSON.stringify(renderer.toJSON())).toContain('not in current inventory')
  const sound = renderer.root
    .findAllByType(Switch)
    .find((row) => row.props.accessibilityLabel.startsWith('Silent delivery'))!
  await act(async () => sound.props.onValueChange(true))
  expect(save).toHaveBeenCalledWith({
    ...policy,
    deviceOverrides: [{ deviceId: 'phone', muted: true, silent: true }]
  })
})
