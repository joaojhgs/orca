// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManagerReplyForm } from './ManagerReplyForm'

afterEach(cleanup)
describe('ManagerReplyForm', () => {
  it('keeps an unconfirmed reply and clears it only after acceptance', async () => {
    const onSend = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(
      <ManagerReplyForm disabled={false} replyTo={null} onCancelAnswer={vi.fn()} onSend={onSend} />
    )
    const input = screen.getByRole('textbox', { name: 'Message Hermes' })
    fireEvent.change(input, { target: { value: 'Keep the existing branch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    expect(input).toHaveValue('Keep the existing branch')
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('sends the selected question id without implying an approval grant', async () => {
    const onSend = vi.fn().mockResolvedValue(true)
    render(
      <ManagerReplyForm
        disabled={false}
        replyTo="question-1"
        onCancelAnswer={vi.fn()}
        onSend={onSend}
      />
    )
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Use the worker' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Use the worker', 'question-1'))
    expect(screen.getByText(/do not grant new permissions/)).toBeVisible()
  })

  it('blocks sending while the request is already in flight', () => {
    const onSend = vi.fn()
    render(<ManagerReplyForm disabled replyTo={null} onCancelAnswer={vi.fn()} onSend={onSend} />)
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled()
    expect(onSend).not.toHaveBeenCalled()
  })
})
