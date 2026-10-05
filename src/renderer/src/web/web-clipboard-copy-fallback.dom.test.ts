// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyClipboardTextViaExecCommand } from './web-clipboard-copy-fallback'

afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(document, 'execCommand')
  vi.restoreAllMocks()
})

describe('explicit browser copy ownership', () => {
  it('beats a retained terminal capture handler without placing copied text in the DOM', () => {
    const terminal = document.createElement('textarea')
    terminal.value = 'old terminal selection'
    document.body.appendChild(terminal)
    terminal.focus()
    const intercepted = vi.fn((event: Event) => event.stopImmediatePropagation())
    terminal.addEventListener('copy', intercepted, true)
    const setData = vi.fn()
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        const event = new Event('copy', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', { value: { setData } })
        terminal.dispatchEvent(event)
        return true
      })
    })
    expect(copyClipboardTextViaExecCommand('Codex response')).toBe(true)
    expect(setData).toHaveBeenCalledExactlyOnceWith('text/plain', 'Codex response')
    expect(intercepted).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('Codex response')
    expect(document.activeElement).toBe(terminal)
    terminal.dispatchEvent(new Event('copy', { bubbles: true }))
    expect(intercepted).toHaveBeenCalledOnce()
    Reflect.deleteProperty(document, 'execCommand')
  })
})
