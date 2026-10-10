import AsyncStorage from '@react-native-async-storage/async-storage'
import { sha256 } from '@noble/hashes/sha256'
import {
  PendingManagerMutationSchema,
  type PendingManagerMutation
} from '../../../src/shared/manager-conversation-request'

const prefix = 'orca:manager-pending:v1:'
const mutations = new Map<string, Promise<void>>()

export function managerReceiptOwnerKey(hostId: string, pairingIdentity: string): string {
  if (!hostId || !pairingIdentity || pairingIdentity === 'orca-page-client') {
    throw new Error('Manager request recovery needs this controller’s native pairing identity.')
  }
  const digest = Array.from(sha256(JSON.stringify([hostId, pairingIdentity])), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  return prefix + digest
}

function validateOwnerKey(key: string): void {
  if (!new RegExp(`^${prefix}[a-f0-9]{64}$`).test(key)) {
    throw new Error('Manager request recovery identity is invalid.')
  }
}

async function locked<T>(key: string, action: () => Promise<T>): Promise<T> {
  validateOwnerKey(key)
  const previous = mutations.get(key) ?? Promise.resolve()
  const operation = previous.then(action, action)
  const tail = operation.then(
    () => undefined,
    () => undefined
  )
  mutations.set(key, tail)
  try {
    return await operation
  } finally {
    if (mutations.get(key) === tail) {
      mutations.delete(key)
    }
  }
}

async function readStored(key: string): Promise<PendingManagerMutation | null> {
  const value = await AsyncStorage.getItem(key)
  if (value === null) {
    return null
  }
  if (value.length > 192 * 1024) {
    throw new Error('Manager request receipt exceeds its recovery budget.')
  }
  return PendingManagerMutationSchema.parse(JSON.parse(value))
}

export function readMobileManagerReceipt(key: string): Promise<PendingManagerMutation | null> {
  return locked(key, () => readStored(key))
}

export function saveMobileManagerReceipt(
  key: string,
  input: PendingManagerMutation
): Promise<void> {
  return locked(key, async () => {
    const parsed = PendingManagerMutationSchema.parse(input)
    const encoded = JSON.stringify(parsed)
    const earlier = await readStored(key)
    if (earlier && JSON.stringify(earlier) !== encoded) {
      throw new Error('Reconcile the unconfirmed manager request before sending another.')
    }
    await AsyncStorage.setItem(key, encoded)
    if (JSON.stringify(await readStored(key)) !== encoded) {
      throw new Error('Manager request recovery was not saved. No new request can be sent.')
    }
  })
}

export function clearMobileManagerReceipt(key: string, requestId: string): Promise<void> {
  return locked(key, async () => {
    const current = await readStored(key)
    if (!current) {
      return
    }
    if (current.requestId !== requestId) {
      throw new Error('A different request owns this manager recovery receipt.')
    }
    await AsyncStorage.removeItem(key)
    if ((await readStored(key)) !== null) {
      throw new Error(
        'Manager request was accepted, but its recovery receipt could not be cleared.'
      )
    }
  })
}
