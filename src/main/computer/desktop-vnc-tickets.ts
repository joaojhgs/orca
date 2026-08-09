import { randomBytes } from 'node:crypto'

const TICKET_TTL_MS = 30_000
const MAX_TICKETS = 32
const tickets = new Map<string, number>()

export function mintDesktopVncTicket(now = Date.now()): string {
  pruneExpiredTickets(now)
  while (tickets.size >= MAX_TICKETS) {
    tickets.delete(tickets.keys().next().value as string)
  }
  const ticket = randomBytes(32).toString('base64url')
  tickets.set(ticket, now + TICKET_TTL_MS)
  return ticket
}

export function consumeDesktopVncTicket(ticket: string, now = Date.now()): boolean {
  const expiresAt = tickets.get(ticket)
  tickets.delete(ticket)
  return expiresAt !== undefined && expiresAt >= now
}

export function resetDesktopVncTicketsForTest(): void {
  tickets.clear()
}

function pruneExpiredTickets(now: number): void {
  for (const [ticket, expiresAt] of tickets) {
    if (expiresAt < now) {
      tickets.delete(ticket)
    }
  }
}
