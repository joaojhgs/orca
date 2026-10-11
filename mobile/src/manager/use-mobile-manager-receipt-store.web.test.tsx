import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BridgeRpcClient } from '../mobile-web-shell/bridge/bridge-rpc-client'
import type {
  MobileManagerReceiptBinding,
  MobileManagerReceiptStore
} from './mobile-manager-receipt-store-contract'
import {
  createFakeBridgePortPair,
  type BridgePortPair
} from '../mobile-web-shell/bridge/bridge-port-pair-test-harness'
import { createFakeRpcClient } from '../mobile-web-shell/bridge-host-test-fakes'

const mocks = vi.hoisted(
  (): { client: BridgeRpcClient | null; bind: ReturnType<typeof vi.fn> } => ({
    client: null,
    bind: vi.fn()
  })
)
vi.mock('../transport/client-context.web', () => ({
  usePageBridgeClientIfPresent: () => mocks.client
}))
vi.mock('./page-manager-receipt-store', () => ({ pageManagerReceiptStore: mocks.bind }))
import { useMobileManagerReceiptStore } from './use-mobile-manager-receipt-store.web'

let renderer: ReturnType<typeof create> | null
let pair: BridgePortPair | null
let binding: MobileManagerReceiptBinding
function Probe() {
  binding = useMobileManagerReceiptStore('host-a', 'orca-page-client')
  return null
}
function receipts(ownerKey: string): MobileManagerReceiptStore {
  return {
    ownerKey,
    read: async () => null,
    save: async () => undefined,
    clear: async () => undefined
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  renderer = null
  pair = null
  mocks.client = null
})
afterEach(() => {
  act(() => renderer?.unmount())
  pair?.client.close()
  pair?.host.dispose()
})

describe('mobile page receipt binding lifetime', () => {
  it('rebinds on a connected-to-connected migration even while the first read is still pending', async () => {
    let generation = 1
    const rpc = createFakeRpcClient({ getGeneration: () => generation })
    pair = createFakeBridgePortPair({ rpc })
    await pair.flush()
    mocks.client = pair.client
    let settleOld: ((value: MobileManagerReceiptStore) => void) | undefined
    mocks.bind.mockImplementationOnce(
      () =>
        new Promise<MobileManagerReceiptStore>((resolve) => {
          settleOld = resolve
        })
    )
    const current = receipts('current-owner')
    mocks.bind.mockResolvedValue(current)
    act(() => {
      renderer = create(createElement(Probe))
    })
    expect(binding.store).toBeNull()
    await act(async () => {
      generation += 1
      rpc.pushState('connected')
      await pair?.flush()
    })
    expect(mocks.bind).toHaveBeenCalledTimes(2)
    expect(binding.store).toBe(current)
    await act(async () => {
      settleOld?.(receipts('retired-owner'))
      await Promise.resolve()
    })
    expect(binding.store).toBe(current)
  })

  it('does not borrow native credentials or provide a storage fallback outside the paired shell', () => {
    act(() => {
      renderer = create(createElement(Probe))
    })
    expect(binding).toEqual({ store: null, error: 'Open Manager inside a paired Orca mobile app.' })
    expect(mocks.bind).not.toHaveBeenCalled()
  })
})
