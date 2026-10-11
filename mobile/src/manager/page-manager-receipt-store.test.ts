import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingManagerMutation } from '../../../src/shared/manager-conversation-request'
import {
  createFakeBridgePortPair,
  type BridgePortPair
} from '../mobile-web-shell/bridge/bridge-port-pair-test-harness'
import { createFakeRpcClient } from '../mobile-web-shell/bridge-host-test-fakes'
import {
  MANAGER_RECEIPT_VERBS,
  isManagerReceiptVerb
} from '../mobile-web-shell/bridge/bridge-manager-receipt-verbs'

const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }))
import { managerReceiptOwnerKey } from './mobile-manager-request-store'
import { createNativeManagerReceiptVerbServer } from './native-manager-receipt-verb-server'
import { pageManagerReceiptStore } from './page-manager-receipt-store'

const request: PendingManagerMutation = {
  kind: 'send',
  requestId: 'request-a',
  runId: 'run-a',
  body: 'Continue with the approved objective.',
  replyTo: 'question-a'
}
const pairs: BridgePortPair[] = []
let values: Map<string, string>
let identity: string | null

async function paired(options: Parameters<typeof createFakeBridgePortPair>[0] = {}) {
  const serve = createNativeManagerReceiptVerbServer({
    hostId: 'host-a',
    readClientIdentity: () => identity
  })
  const pair = createFakeBridgePortPair({
    ...options,
    serveNativeVerb: async (verb, params) => {
      if (!isManagerReceiptVerb(verb)) {
        throw new Error('Unexpected native verb')
      }
      return serve(verb, params)
    }
  })
  pairs.push(pair)
  await pair.flush()
  return pair
}

beforeEach(() => {
  vi.clearAllMocks()
  values = new Map()
  identity = 'private-native-pairing'
  storage.getItem.mockImplementation(async (key: string) => values.get(key) ?? null)
  storage.setItem.mockImplementation(async (key: string, value: string) => {
    values.set(key, value)
  })
  storage.removeItem.mockImplementation(async (key: string) => {
    values.delete(key)
  })
})
afterEach(() => {
  for (const pair of pairs.splice(0)) {
    pair.client.close()
    pair.host.dispose()
  }
})

describe('native-owned manager receipts through the real mobile bridge', () => {
  it('acknowledges verified storage, recovers the exact request, and never forwards native verbs or credentials', async () => {
    const pair = await paired()
    const store = await pageManagerReceiptStore(pair.client, 'host-a')
    expect(await store.read()).toBeNull()
    await store.save(request)
    const reopened = await pageManagerReceiptStore(pair.client, 'host-a')
    expect(await reopened.read()).toEqual(request)
    await reopened.clear(request.requestId)
    expect(await store.read()).toBeNull()
    expect(pair.rpc.requests).toEqual([])
    expect(pair.storageWrites).toEqual([])
    expect(store.ownerKey).toBe(managerReceiptOwnerKey('host-a', 'private-native-pairing'))
    expect(JSON.stringify([...pair.toShell, ...pair.toPage])).not.toContain(
      'private-native-pairing'
    )
  })

  it('refuses cross-host storage and older shells before sending a receipt request', async () => {
    const pair = await paired({ routeGrants: ['navigate', 'storage'] })
    const sent = pair.toShell.length
    await expect(pageManagerReceiptStore(pair.client, 'host-a')).rejects.toThrow('Update the app')
    expect(pair.toShell).toHaveLength(sent)
    const capable = await paired()
    await expect(pageManagerReceiptStore(capable.client, 'host-b')).rejects.toThrow(
      'Update the app'
    )
    expect(storage.getItem).not.toHaveBeenCalled()
  })

  it('will not acknowledge a write that storage silently lost', async () => {
    const pair = await paired()
    const store = await pageManagerReceiptStore(pair.client, 'host-a')
    storage.setItem.mockResolvedValue(undefined)
    await expect(store.save(request)).rejects.toThrow()
    expect(await store.read()).toBeNull()
    expect(pair.rpc.requests).toEqual([])
  })

  it('retains the exact request when storage cannot confirm deletion', async () => {
    const pair = await paired()
    const store = await pageManagerReceiptStore(pair.client, 'host-a')
    await store.save(request)
    storage.removeItem.mockResolvedValue(undefined)
    await expect(store.clear(request.requestId)).rejects.toThrow()
    expect(await store.read()).toEqual(request)
    await expect(store.clear('another-request')).rejects.toThrow()
    await expect(store.save({ ...request, requestId: 'another-request' })).rejects.toThrow()
    expect(await store.read()).toEqual(request)
  })

  it('refuses a changed pairing without reading or overwriting its new receipt', async () => {
    const pair = await paired()
    const store = await pageManagerReceiptStore(pair.client, 'host-a')
    await store.save(request)
    identity = 'repaired-native-identity'
    await expect(store.save(request)).rejects.toThrow()
    await expect(store.clear(request.requestId)).rejects.toThrow()
    const reads = storage.getItem.mock.calls.length
    await expect(store.read()).rejects.toThrow()
    expect(storage.getItem.mock.calls).toHaveLength(reads)
    const next = await pageManagerReceiptStore(pair.client, 'host-a')
    expect(await next.read()).toBeNull()
    expect(JSON.parse(values.get(store.ownerKey) ?? 'null')).toEqual(request)
  })

  it('refuses reads when the pairing changes while native storage is awaiting a result', async () => {
    const pair = await paired()
    storage.getItem.mockImplementationOnce(async () => {
      identity = 'repaired-native-identity'
      return JSON.stringify(request)
    })
    await expect(pageManagerReceiptStore(pair.client, 'host-a')).rejects.toThrow()
    expect(pair.toPage.join('')).not.toContain(request.body)
  })

  it('requires a native pairing and strictly rejects page-selected storage paths and credential fields', async () => {
    const pair = await paired()
    identity = null
    await expect(pageManagerReceiptStore(pair.client, 'host-a')).rejects.toThrow()
    identity = 'private-native-pairing'
    for (const verb of MANAGER_RECEIPT_VERBS) {
      await expect(
        pair.client.callNativeVerb(verb, { key: 'arbitrary-path', deviceToken: 'token' })
      ).rejects.toThrow()
    }
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  it('invalidates a bound store on a connected-to-connected generation change while preserving its native receipt', async () => {
    let generation = 1
    const rpc = createFakeRpcClient({ getGeneration: () => generation })
    const pair = await paired({ rpc })
    const store = await pageManagerReceiptStore(pair.client, 'host-a')
    await store.save(request)
    generation += 1
    rpc.pushState('connected')
    await pair.flush()
    await expect(store.read()).rejects.toThrow('connection changed')
    await expect(store.clear(request.requestId)).rejects.toThrow('connection changed')
    expect(await (await pageManagerReceiptStore(pair.client, 'host-a')).read()).toEqual(request)
  })

  it('keeps recovery after the page disappears following a native write', async () => {
    const pair = await paired()
    const store = await pageManagerReceiptStore(pair.client, 'host-a')
    storage.setItem.mockImplementationOnce(async (key: string, value: string) => {
      values.set(key, value)
      pair.client.close()
    })
    await expect(store.save(request)).rejects.toThrow()
    const reopened = await paired()
    expect(await (await pageManagerReceiptStore(reopened.client, 'host-a')).read()).toEqual(request)
  })
})
