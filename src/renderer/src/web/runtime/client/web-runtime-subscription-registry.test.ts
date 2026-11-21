import { expect, it, vi } from 'vitest'
import { WebRuntimeSubscriptionRegistry } from './web-runtime-subscription-registry'

it('restores the terminal subscription after the paired transport reconnects', () => {
  const sendEncrypted = vi.fn(() => true)
  const onClose = vi.fn()
  const registry = new WebRuntimeSubscriptionRegistry({
    deviceToken: 'token',
    nextId: () => 'reconnected',
    sendEncrypted
  })
  registry.subscriptions.set('original', {
    id: 'original',
    method: 'terminal.multiplex',
    params: {},
    callbacks: { onResponse: vi.fn(), onClose },
    needsReplay: false
  })
  registry.handleInterrupted()
  registry.replayInterrupted()
  expect(sendEncrypted).toHaveBeenCalledExactlyOnceWith({
    id: 'reconnected',
    deviceToken: 'token',
    method: 'terminal.multiplex',
    params: {}
  })
  expect(onClose).not.toHaveBeenCalled()
})
