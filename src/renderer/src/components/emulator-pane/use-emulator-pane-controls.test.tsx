// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useEmulatorPaneControls } from './use-emulator-pane-controls'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let latest: ReturnType<typeof useEmulatorPaneControls> | null = null

function Harness() {
  latest = useEmulatorPaneControls('worktree-1')
  return null
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<Harness />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  latest = null
})

describe('useEmulatorPaneControls', () => {
  it('adopts the first stream dimensions as the initial visual orientation', () => {
    expect(latest?.visualOrientation).toBe('portrait')

    act(() => latest?.syncVisualOrientationFromStream(1280, 768))
    expect(latest?.visualOrientation).toBe('landscape')

    act(() => latest?.resetVisualOrientation())
    act(() => latest?.syncVisualOrientationFromStream(1080, 2400))
    expect(latest?.visualOrientation).toBe('portrait')
  })
})
