import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRemoteTerminalStreamWatchdog,
  REMOTE_TERMINAL_DELIVERY_STALL_TIMEOUT_MS
} from './remote-terminal-stream-watchdog'

describe('remote terminal stream watchdog', () => {
  afterEach(() => vi.useRealTimers())

  it('probes a working agent after an otherwise silent stream and rearms after success', () => {
    vi.useFakeTimers()
    const onStall = vi.fn()
    const watchdog = createRemoteTerminalStreamWatchdog(onStall)

    watchdog.setActivityExpected(true)
    vi.advanceTimersByTime(REMOTE_TERMINAL_DELIVERY_STALL_TIMEOUT_MS)
    expect(onStall).toHaveBeenCalledTimes(1)

    watchdog.completeCommandResponseProbe()
    vi.advanceTimersByTime(REMOTE_TERMINAL_DELIVERY_STALL_TIMEOUT_MS)
    expect(onStall).toHaveBeenCalledTimes(2)
  })

  it('does not probe an idle terminal', () => {
    vi.useFakeTimers()
    const onStall = vi.fn()
    const watchdog = createRemoteTerminalStreamWatchdog(onStall)

    watchdog.setActivityExpected(true)
    watchdog.setActivityExpected(false)
    vi.advanceTimersByTime(REMOTE_TERMINAL_DELIVERY_STALL_TIMEOUT_MS)

    expect(onStall).not.toHaveBeenCalled()
  })
})
