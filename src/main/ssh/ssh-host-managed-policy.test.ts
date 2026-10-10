import { describe, expect, it } from 'vitest'
import { keepCustomizedRelayOnConnect } from './ssh-host-managed-policy'

describe('customized SSH transport policy', () => {
  it('keeps existing and new direct SSH hosts on the relay, even without terminals', () => {
    expect(keepCustomizedRelayOnConnect({})).toBe(true)
  })

  it('does not silently undo a deliberately provisioned managed host', () => {
    expect(
      keepCustomizedRelayOnConnect({
        orcadProvisioning: {
          requestId: 'managed-host',
          name: 'Managed host'
        }
      })
    ).toBe(false)
  })

  it('keeps an explicitly migrated host managed', () => {
    expect(keepCustomizedRelayOnConnect({ orcadFence: { environmentId: 'managed' } })).toBe(false)
  })
})
