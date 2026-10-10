import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingManagerMutation } from '../../../src/shared/manager-conversation-request'

const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }))
import {
  clearMobileManagerReceipt,
  managerReceiptOwnerKey,
  readMobileManagerReceipt,
  saveMobileManagerReceipt
} from './mobile-manager-request-store'

const request: PendingManagerMutation = {
  kind: 'create',
  requestId: 'request-1',
  principalId: 'principal-1',
  workspaceId: 'folder:project',
  objective: 'Build the project'
}
const owner = managerReceiptOwnerKey('controller-a', 'private-pairing-a')

describe('native manager request recovery', () => {
  let values: Map<string, string>
  beforeEach(() => {
    vi.clearAllMocks()
    values = new Map()
    storage.getItem.mockImplementation(async (key: string) => values.get(key) ?? null)
    storage.setItem.mockImplementation(async (key: string, value: string) => {
      values.set(key, value)
    })
    storage.removeItem.mockImplementation(async (key: string) => {
      values.delete(key)
    })
  })

  it('isolates paired controllers and repairs without storing raw pairing tokens', () => {
    const keys = [
      owner,
      managerReceiptOwnerKey('controller-b', 'private-pairing-a'),
      managerReceiptOwnerKey('controller-a', 'private-pairing-b')
    ]
    expect(new Set(keys).size).toBe(3)
    for (const key of keys) {
      expect(key).toMatch(/^orca:manager-pending:v1:[a-f0-9]{64}$/)
      expect(key).not.toContain('private-pairing')
    }
  })

  it.each(['', 'orca-page-client'])(
    'refuses an unavailable native pairing identity: %s',
    (identity) => {
      expect(() => managerReceiptOwnerKey('controller-a', identity)).toThrow(
        'native pairing identity'
      )
    }
  )

  it('verifies persistence and reuses the exact receipt across mounts', async () => {
    await saveMobileManagerReceipt(owner, request)
    expect(storage.getItem).toHaveBeenCalledTimes(2)
    expect(await readMobileManagerReceipt(owner)).toEqual(request)
    await saveMobileManagerReceipt(owner, request)
    expect(values.size).toBe(1)
    expect([...values.values()].join('')).not.toContain('private-pairing')
  })

  it('rejects storage that acknowledges a write without persisting it', async () => {
    storage.setItem.mockResolvedValue(undefined)
    await expect(saveMobileManagerReceipt(owner, request)).rejects.toThrow('was not saved')
  })

  it('serializes competing requests and refuses to replace an unresolved receipt', async () => {
    const outcomes = await Promise.allSettled([
      saveMobileManagerReceipt(owner, request),
      saveMobileManagerReceipt(owner, { ...request, requestId: 'request-2' })
    ])
    expect(outcomes.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(await readMobileManagerReceipt(owner)).toEqual(request)
  })

  it('refuses changed content even when the request ID is reused', async () => {
    await saveMobileManagerReceipt(owner, request)
    await expect(
      saveMobileManagerReceipt(owner, { ...request, objective: 'Another objective' })
    ).rejects.toThrow('Reconcile')
  })

  it('clears only the acknowledged request, verifying deletion', async () => {
    await saveMobileManagerReceipt(owner, request)
    await expect(clearMobileManagerReceipt(owner, 'request-2')).rejects.toThrow('different request')
    expect(await readMobileManagerReceipt(owner)).toEqual(request)
    storage.removeItem.mockResolvedValueOnce(undefined)
    await expect(clearMobileManagerReceipt(owner, request.requestId)).rejects.toThrow(
      'could not be cleared'
    )
    await clearMobileManagerReceipt(owner, request.requestId)
    expect(await readMobileManagerReceipt(owner)).toBeNull()
  })

  it('fails closed on invalid receipts, excessive content and unscoped keys', async () => {
    values.set(owner, JSON.stringify({ ...request, serviceToken: 'must-not-be-stored' }))
    await expect(readMobileManagerReceipt(owner)).rejects.toThrow()
    values.set(owner, ' '.repeat(192 * 1024 + 1))
    await expect(readMobileManagerReceipt(owner)).rejects.toThrow('recovery budget')
    await expect(readMobileManagerReceipt('controller-a')).rejects.toThrow('identity is invalid')
  })

  it('preserves a transport error from the storage API and allows a subsequent retry', async () => {
    const error = new Error('disk unavailable')
    storage.getItem.mockRejectedValueOnce(error)
    await expect(readMobileManagerReceipt(owner)).rejects.toBe(error)
    await saveMobileManagerReceipt(owner, request)
    expect(await readMobileManagerReceipt(owner)).toEqual(request)
  })
})
