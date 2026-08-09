import { beforeEach, describe, expect, it } from 'vitest'
import {
  consumeDesktopVncTicket,
  mintDesktopVncTicket,
  resetDesktopVncTicketsForTest
} from './desktop-vnc-tickets'

describe('desktop VNC tickets', () => {
  beforeEach(resetDesktopVncTicketsForTest)

  it('consumes a ticket once', () => {
    const ticket = mintDesktopVncTicket(1_000)

    expect(consumeDesktopVncTicket(ticket, 1_001)).toBe(true)
    expect(consumeDesktopVncTicket(ticket, 1_002)).toBe(false)
  })

  it('rejects expired tickets', () => {
    const ticket = mintDesktopVncTicket(1_000)

    expect(consumeDesktopVncTicket(ticket, 31_001)).toBe(false)
  })
})
