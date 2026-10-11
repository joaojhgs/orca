import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { FakeSession } from '../transport/mobile-endpoint-supervisor-test-fakes'
import { useMobileNotificationPolicy } from './use-mobile-notification-policy'

const receipt = { revision: 'a'.repeat(64), policy: { rules: [], deviceOverrides: [] } }
let latest: ReturnType<typeof useMobileNotificationPolicy> | null = null
let renderer: ReactTestRenderer
const view = () => {
  if (!latest) {
    throw new Error('Hook not mounted')
  }
  return latest
}
function Probe({ client, owner }: { client: RpcClient; owner: string }) {
  latest = useMobileNotificationPolicy(client, owner)
  return null
}
function ready(label: string) {
  const client = new FakeSession('connected')
  client.sendRequest.mockImplementation(async (method) => ({
    id: 'reply',
    ok: true,
    result:
      method === 'notifications.policyTargets'
        ? { targets: [{ label, selector: { level: 'server' }, scope: {} }], nextOffset: null }
        : method === 'pairing.admin.listDevices'
          ? { devices: [] }
          : receipt
  }))
  return client
}
afterEach(() => {
  act(() => renderer?.unmount())
  latest = null
})

it('loads only the chosen server and includes saved disconnected scopes without losing device overrides', async () => {
  const client = ready('Controller')
  const saved = {
    ...receipt,
    policy: {
      rules: [
        {
          id: 'saved-rule',
          selector: { level: 'workspace', id: 'offline-folder', executionHostId: 'ssh:offline' },
          manager: true
        }
      ],
      deviceOverrides: [{ deviceId: 'phone', muted: true }]
    }
  }
  client.sendRequest.mockResolvedValueOnce({ id: 'reply', ok: true, result: saved })
  await act(async () => {
    renderer = create(createElement(Probe, { client, owner: 'controller' }))
  })
  expect(view().receipt).toEqual(saved)
  expect(view().targets).toHaveLength(2)
  expect(view().targets[1].selector).toEqual(saved.policy.rules[0].selector)
})

it('ignores a delayed old-server read when selection changes', async () => {
  const previous = ready('Previous')
  let finish!: (reply: RpcResponse) => void
  previous.sendRequest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await act(async () => {
    renderer = create(createElement(Probe, { client: previous, owner: 'previous' }))
  })
  const current = ready('Current')
  await act(async () => {
    renderer.update(createElement(Probe, { client: current, owner: 'current' }))
  })
  await act(async () => finish({ id: 'reply', ok: true, result: receipt }))
  expect(view().targets.map((row) => row.label)).toEqual(['Current'])
  expect(previous.sendRequest).toHaveBeenCalledTimes(1)
  expect(view().error).toBeNull()
})

it('ignores a delayed old-server save without releasing or replacing a new-server save', async () => {
  const previous = ready('Previous')
  await act(async () => {
    renderer = create(createElement(Probe, { client: previous, owner: 'previous' }))
  })
  let finish!: (reply: RpcResponse) => void
  previous.sendRequest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await act(async () => {
    void view().save(receipt.policy)
  })
  const current = ready('Current')
  await act(async () => {
    renderer.update(createElement(Probe, { client: current, owner: 'current' }))
  })
  let finishCurrent!: (reply: RpcResponse) => void
  current.sendRequest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishCurrent = resolve
      })
  )
  await act(async () => {
    void view().save(receipt.policy)
  })
  await act(async () =>
    finish({ id: 'reply', ok: true, result: { ...receipt, revision: 'b'.repeat(64) } })
  )
  expect(view().busy).toBe(true)
  expect(view().receipt?.revision).toBe(receipt.revision)
  await act(async () =>
    finishCurrent({ id: 'reply', ok: true, result: { ...receipt, revision: 'c'.repeat(64) } })
  )
  expect(view().busy).toBe(false)
  expect(view().receipt?.revision).toBe('c'.repeat(64))
})

it('requires a fresh read after a lost or conflicting save and never automatically retries', async () => {
  const client = ready('Controller')
  await act(async () => {
    renderer = create(createElement(Probe, { client, owner: 'controller' }))
  })
  client.sendRequest.mockRejectedValueOnce(new Error('Notification policy changed elsewhere'))
  await act(async () => view().save(receipt.policy))
  expect(view().receipt).toBeNull()
  expect(view().error).toContain('Refresh before retrying')
  await act(async () => view().save(receipt.policy))
  expect(client.sendRequest).toHaveBeenCalledTimes(4)
  await act(async () => view().refresh())
  expect(view().receipt).toEqual(receipt)
})

it('does not refresh or admit a second save while the first mutation is unresolved', async () => {
  const client = ready('Controller')
  await act(async () => {
    renderer = create(createElement(Probe, { client, owner: 'controller' }))
  })
  let finish!: (reply: RpcResponse) => void
  client.sendRequest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await act(async () => {
    void view().save(receipt.policy)
  })
  await act(async () => {
    void view().refresh()
    void view().save(receipt.policy)
  })
  expect(client.sendRequest).toHaveBeenCalledTimes(4)
  await act(async () => finish({ id: 'reply', ok: true, result: receipt }))
  expect(view().busy).toBe(false)
})
