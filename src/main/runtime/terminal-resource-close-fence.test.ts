import { describe, expect, it } from 'vitest'
import { createHarness } from './__fixtures__/orca-runtime-terminal-close-continuity-fixtures'
import {
  INCARNATION_ID,
  PTY_ID
} from './__fixtures__/orca-runtime-terminal-close-continuity-state-fixture'

describe('resource manager terminal close fence', () => {
  it('refuses a stale incarnation without killing a session or changing its surface', async () => {
    const harness = await createHarness({ registerPtyBacked: true, publishMobileSurface: true })
    await harness.syncFixtureGraph()
    const handle = harness.runtime.preAllocateHandleForPty(PTY_ID)
    await expect(harness.runtime.closeTerminal(handle, 'other-incarnation')).rejects.toThrow(
      'terminal_incarnation_mismatch'
    )
    expect(harness.kill).not.toHaveBeenCalled()
    expect(harness.stopAndWait).not.toHaveBeenCalled()
    expect(harness.closeTerminal).not.toHaveBeenCalled()
  })
  it('allows an explicit close for the verified current incarnation', async () => {
    const harness = await createHarness({ registerPtyBacked: true, publishMobileSurface: true })
    await harness.syncFixtureGraph()
    harness.acknowledged.resolve()
    harness.setVerifiedStopResult(true)
    const handle = harness.runtime.preAllocateHandleForPty(PTY_ID)
    await expect(harness.runtime.closeTerminal(handle, INCARNATION_ID)).resolves.toMatchObject({
      ptyKilled: true
    })
  })
})
