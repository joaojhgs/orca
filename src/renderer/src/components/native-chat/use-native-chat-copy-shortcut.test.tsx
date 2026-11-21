// @vitest-environment happy-dom
import { useRef } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNativeChatCopyShortcut } from './use-native-chat-copy-shortcut'

const copy = vi.hoisted(() => vi.fn().mockResolvedValue(true))
vi.mock('./native-chat-clipboard', () => ({ copyNativeChatText: copy }))
afterEach(() => {
  cleanup()
  window.getSelection()?.removeAllRanges()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function Harness({ enabled = true }: { enabled?: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  useNativeChatCopyShortcut(root, enabled)
  return (
    <div ref={root}>
      <span data-testid="answer">Codex answer</span>
      <textarea />
    </div>
  )
}

function select(node: Node) {
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(node)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

describe('chat copy keyboard routing', () => {
  it.each([false, true])('copies a chat selection with Ctrl+C (shift=%s)', (shiftKey) => {
    const view = render(<Harness />)
    select(view.getByTestId('answer'))
    const terminalHandler = vi.fn()
    document.addEventListener('keydown', terminalHandler)
    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      shiftKey,
      bubbles: true,
      cancelable: true
    })
    document.dispatchEvent(event)
    expect(copy).toHaveBeenCalledExactlyOnceWith('Codex answer')
    expect(event.defaultPrevented).toBe(true)
    expect(terminalHandler).not.toHaveBeenCalled()
    document.removeEventListener('keydown', terminalHandler)
  })

  it('uses Command on Mac instead of Control', () => {
    vi.stubGlobal('navigator', { userAgent: 'Macintosh' })
    const view = render(<Harness />)
    select(view.getByTestId('answer'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))
    expect(copy).not.toHaveBeenCalled()
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'c', metaKey: true, cancelable: true })
    )
    expect(copy).toHaveBeenCalledExactlyOnceWith('Codex answer')
  })

  it('does not intercept composer copying or a hidden chat', () => {
    const view = render(<Harness />)
    select(view.getByTestId('answer'))
    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })
    view.container.querySelector('textarea')?.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(copy).not.toHaveBeenCalled()
    view.rerender(<Harness enabled={false} />)
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, cancelable: true })
    )
    expect(copy).not.toHaveBeenCalled()
  })

  it('does not intercept selections outside the chat', () => {
    const view = render(<Harness />)
    const outside = document.createElement('p')
    outside.textContent = 'outside'
    view.container.appendChild(outside)
    select(outside)
    const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, cancelable: true })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(copy).not.toHaveBeenCalled()
  })
})
