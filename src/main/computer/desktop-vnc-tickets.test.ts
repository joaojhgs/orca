import { beforeEach, describe, expect, it } from 'vitest'
import {
  consumeDesktopVncTicket,
  consumeDesktopVncTicketTarget,
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

  it('binds a target snapshot to the ticket', () => {
    const ticket = mintDesktopVncTicket({ id: 'game', port: 5901, viewOnly: true }, 1_000)

    expect(consumeDesktopVncTicketTarget(ticket, 1_001)).toEqual({
      id: 'game',
      port: 5901,
      viewOnly: true
    })
    expect(consumeDesktopVncTicketTarget(ticket, 1_002)).toBeNull()
  })

  it('does not let source object mutation redirect a ticket', () => {
    const target = { id: 'game', port: 5901, viewOnly: true }
    const ticket = mintDesktopVncTicket(target, 1_000)
    target.id = 'art'
    target.port = 5902
    target.viewOnly = false

    expect(consumeDesktopVncTicketTarget(ticket, 1_001)).toEqual({
      id: 'game',
      port: 5901,
      viewOnly: true
    })
  })

  it('uses the main desktop target for legacy tickets', () => {
    const ticket = mintDesktopVncTicket(1_000)

    expect(consumeDesktopVncTicketTarget(ticket, 1_001)).toEqual({
      id: 'main',
      port: 5900,
      viewOnly: false
    })
  })
})
