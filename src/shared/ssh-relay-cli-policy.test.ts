import { describe, expect, it } from 'vitest'
import { isRelayCliControlEnabled } from './ssh-relay-cli-policy'

describe('customized relay CLI compatibility', () => {
  it('preserves coordination for existing relay hosts without new settings', () => {
    expect(isRelayCliControlEnabled({})).toBe(true)
  })
  it('honors explicit disabling and rejects missing hosts', () => {
    expect(isRelayCliControlEnabled({ allowRemoteCliControl: false })).toBe(false)
    expect(isRelayCliControlEnabled(undefined)).toBe(false)
  })
  it('requires opt-in for a deliberately provisioned managed host', () => {
    const orcadProvisioning = { requestId: 'request', name: 'Managed host' }
    expect(isRelayCliControlEnabled({ orcadProvisioning })).toBe(false)
    expect(isRelayCliControlEnabled({ orcadProvisioning, allowRemoteCliControl: true })).toBe(true)
  })
})
