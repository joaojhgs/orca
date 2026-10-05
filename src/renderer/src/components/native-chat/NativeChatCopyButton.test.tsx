// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeChatCopyButton } from './NativeChatCopyButton'

const errorToast = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: errorToast } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('native chat copy', () => {
  it('uses the verified writer and confirms only a completed write', async () => {
    const writeTerminalClipboardText = vi.fn().mockResolvedValue(undefined)
    const writeClipboardText = vi.fn()
    Object.assign(window, { api: { ui: { writeTerminalClipboardText, writeClipboardText } } })
    render(<NativeChatCopyButton text="Codex answer" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument())
    expect(writeTerminalClipboardText).toHaveBeenCalledExactlyOnceWith('Codex answer')
    expect(writeClipboardText).not.toHaveBeenCalled()
  })

  it('reports rejected writes without confirming or exposing platform details', async () => {
    const writeTerminalClipboardText = vi
      .fn()
      .mockRejectedValue(new Error('private platform detail'))
    Object.assign(window, { api: { ui: { writeTerminalClipboardText } } })
    render(<NativeChatCopyButton text="Codex answer" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }))
    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith('Unable to copy text', { description: undefined })
    )
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument()
  })
})
