import { describe, expect, it } from 'vitest'
import { resolveFocusedRuntimeOwner } from './focused-runtime-owner'

describe('focused manager controller ownership', () => {
  const state = {
    settings: { activeRuntimeEnvironmentId: 'controller-b' },
    runtimeEnvironments: [{ id: 'controller-a' }, { id: 'controller-b' }]
  }
  it('honors an explicit desktop selection among several controllers', () => {
    expect(resolveFocusedRuntimeOwner(state, false)).toBe('controller-b')
  })
  it('does not redirect a missing selected peer to the local controller', () => {
    expect(resolveFocusedRuntimeOwner({ ...state, runtimeEnvironments: [] }, false)).toBeUndefined()
  })
  it('uses local only for an explicit native local selection', () => {
    expect(resolveFocusedRuntimeOwner({ ...state, settings: {} }, false)).toBeNull()
  })
  it('uses a browser’s paired controller regardless of saved desktop focus', () => {
    expect(
      resolveFocusedRuntimeOwner({ ...state, runtimeEnvironments: [{ id: 'paired' }] }, true)
    ).toBe('paired')
  })
  it.each([[], [{ id: 'a' }, { id: 'b' }], [{ id: '' }]])(
    'refuses an ambiguous browser owner: %j',
    (runtimeEnvironments) => {
      expect(resolveFocusedRuntimeOwner({ ...state, runtimeEnvironments }, true)).toBeUndefined()
    }
  )
})
