import { randomBytes } from 'node:crypto'

const TICKET_TTL_MS = 30_000
const MAX_TICKETS = 32
export type DesktopVncTicketTarget = Readonly<{
  id: string
  port: number
  viewOnly: boolean
}>

const MAIN_DESKTOP_VNC_TICKET_TARGET: DesktopVncTicketTarget = {
  id: 'main',
  port: 5900,
  viewOnly: false
}

const tickets = new Map<string, { expiresAt: number; target: DesktopVncTicketTarget }>()

export function mintDesktopVncTicket(now?: number): string
export function mintDesktopVncTicket(target: DesktopVncTicketTarget, now?: number): string
export function mintDesktopVncTicket(
  targetOrNow: DesktopVncTicketTarget | number = Date.now(),
  maybeNow?: number
): string {
  const target =
    typeof targetOrNow === 'number'
      ? MAIN_DESKTOP_VNC_TICKET_TARGET
      : { id: targetOrNow.id, port: targetOrNow.port, viewOnly: targetOrNow.viewOnly }
  const now = typeof targetOrNow === 'number' ? targetOrNow : (maybeNow ?? Date.now())
  pruneExpiredTickets(now)
  while (tickets.size >= MAX_TICKETS) {
    tickets.delete(tickets.keys().next().value as string)
  }
  const ticket = randomBytes(32).toString('base64url')
  tickets.set(ticket, { expiresAt: now + TICKET_TTL_MS, target })
  return ticket
}

export function consumeDesktopVncTicket(ticket: string, now = Date.now()): boolean {
  return consumeDesktopVncTicketTarget(ticket, now) !== null
}

export function consumeDesktopVncTicketTarget(
  ticket: string,
  now = Date.now()
): DesktopVncTicketTarget | null {
  const entry = tickets.get(ticket)
  tickets.delete(ticket)
  return entry !== undefined && entry.expiresAt >= now ? entry.target : null
}

export function resetDesktopVncTicketsForTest(): void {
  tickets.clear()
}

function pruneExpiredTickets(now: number): void {
  for (const [ticket, entry] of tickets) {
    if (entry.expiresAt < now) {
      tickets.delete(ticket)
    }
  }
}
