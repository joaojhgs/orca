import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRemoteTerminalStreamWatchdog,
  REMOTE_TERMINAL_DELIVERY_STALL_TIMEOUT_MS
} from './remote-terminal-stream-watchdog'

describe('remote terminal stream watchdog', () => {
  afterEach(() => vi.useRealTimers())

  it('does not treat an idle terminal as a stalled stream', () => {
    vi.useFakeTimers()
    const onStall = vi.fn()
    const watchdog = createRemoteTerminalStreamWatchdog(onStall)

    watchdog.recordInbound()
    vi.advanceTimersByTime(REMOTE_TERMINAL_DELIVERY_STALL_TIMEOUT_MS * 2)

    expect(onStall).not.toHaveBeenCalled()
  })
})
