import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDefaultTerminalOptions } from './pane-terminal-options'

afterEach(() => vi.unstubAllGlobals())

describe('terminal selection ownership', () => {
  it('keeps desktop TUI mouse interaction unchanged', () => {
    expect(buildDefaultTerminalOptions().mouseEventsRequireAlt).toBe(false)
  })

  it('gives ordinary web drags to browser selection and keeps Alt TUI interaction', () => {
    vi.stubGlobal('__ORCA_WEB_CLIENT__', true)
    expect(buildDefaultTerminalOptions().mouseEventsRequireAlt).toBe(true)
  })
})
