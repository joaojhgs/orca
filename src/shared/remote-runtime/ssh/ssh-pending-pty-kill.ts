import type { SshRemotePtyLease } from './ssh-types'

/** Unconfirmed client-local shutdown, replayed only through the legacy relay bridge for a closed tab’s surviving shell; downgrades replay it too. */
export type SshPendingPtyKill = {
  requestedAt: number
  /** Fence the intended incarnation: legacy pty-N IDs recycle after relay restart (#16970).
   * Current relays enforce it; preflight listProcesses also protects older relays that ignore the field.
   * Only epoch-scoped pty2: IDs may omit it because they cannot recur across starts. */
  incarnationId?: string
  /** Replays attempted since. Diagnostic; the TTL, not this, is the bound. */
  attempts: number
}

/** pty2:<epoch>:<n> has a fresh epoch per start; legacy pty-N IDs recycle. */
export function isEpochScopedRelayPtyId(relayPtyId: string): boolean {
  return relayPtyId.startsWith('pty2:')
}

/** The strict lease loader strips unknown fields; colocate admission so persistence cannot silently lose pending kills. */
export function normalizeSshPendingPtyKill(
  value: unknown,
  relayPtyId: string
): SshPendingPtyKill | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as Partial<SshPendingPtyKill>
  if (typeof raw.requestedAt !== 'number' || !Number.isFinite(raw.requestedAt)) {
    return null
  }
  const attempts = typeof raw.attempts === 'number' && raw.attempts >= 0 ? raw.attempts : 0
  if (raw.incarnationId === undefined && isEpochScopedRelayPtyId(relayPtyId)) {
    return { requestedAt: raw.requestedAt, attempts }
  }
  // Never retain an unfenced kill for a recyclable ID.
  if (
    typeof raw.incarnationId !== 'string' ||
    !raw.incarnationId ||
    raw.incarnationId.length > 128
  ) {
    return null
  }
  return { requestedAt: raw.requestedAt, incarnationId: raw.incarnationId, attempts }
}

export const SSH_PENDING_PTY_KILL_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Per target, newest kept. A permanently unreachable host must not grow the store without bound. */
export const MAX_SSH_PENDING_PTY_KILLS_PER_TARGET = 200

/** The single definition of "too old to act on". Both the durable prune and the decision function
 *  read it, so a stale order cannot be replayed by one and kept by the other. */
export function isSshPendingPtyKillExpired(intent: SshPendingPtyKill, now: number): boolean {
  return now - intent.requestedAt > SSH_PENDING_PTY_KILL_TTL_MS
}

/** What the authoritative host just said about this relay PTY id, from one `pty.listProcesses`. */
export type SshPendingPtyKillObservation = {
  /** False only when the host answered and did not list the id: positive evidence of absence.
   *  A failed or timed-out listing is never expressed here — the caller defers instead. */
  hostListsPty: boolean
  /** The incarnation the host published for that id. `undefined` means the host published none,
   *  which reads as unknown — never as "no incarnation" and never as a match. */
  hostIncarnationId: string | undefined
}

export type SshPendingPtyKillRetirement =
  | 'host-reports-absent'
  | 'relay-id-recycled'
  | 'stop-confirmed'

export type SshPendingPtyKillDecision =
  | { action: 'replay' }
  | { action: 'retire'; reason: Exclude<SshPendingPtyKillRetirement, 'stop-confirmed'> }
  | { action: 'defer'; reason: string }

/** Decides what to do with one recorded kill, given what the host just said about its id.
 *
 *  The TTL is deliberately NOT a branch here. `isSshPendingPtyKillExpired` owns it, applied as a
 *  durable prune before any of this runs, so expired orders are actually deleted from the store
 *  rather than merely skipped — and so there is exactly one place that decides what "too old"
 *  means. A branch here would be unreachable behind that prune and would only look tested.
 *
 *  `defer` is the `unverifiable` branch and asserts nothing: the record stays and the next
 *  handshake asks again. No branch concludes that a PTY exited — only `host-reports-absent` is an
 *  observation of absence, and it comes from the host that owns the process. */
export function decideSshPendingPtyKill(
  intent: SshPendingPtyKill,
  observation: SshPendingPtyKillObservation,
  now: number
): SshPendingPtyKillDecision {
  if (isSshPendingPtyKillExpired(intent, now)) {
    // Unreachable behind the prune, but a stale order must never be aimed at whatever holds the
    // id today if a future caller reaches this without pruning first.
    return { action: 'defer', reason: 'order is past its TTL and awaiting prune' }
  }
  if (!observation.hostListsPty) {
    return { action: 'retire', reason: 'host-reports-absent' }
  }
  if (intent.incarnationId === undefined) {
    // The id is the fence: only an epoch-scoped id is ever recorded without an incarnation.
    return { action: 'replay' }
  }
  if (observation.hostIncarnationId === undefined) {
    // Why not replay: an unfenced kill against a renumbered relay id destroys a shell nobody asked
    // to close, which is strictly worse than the leak. Hosts predating the published incarnation
    // therefore degrade to no replay rather than to a guess.
    return { action: 'defer', reason: 'host published no PTY incarnation for this id' }
  }
  if (observation.hostIncarnationId !== intent.incarnationId) {
    return { action: 'retire', reason: 'relay-id-recycled' }
  }
  return { action: 'replay' }
}

export type SshPendingPtyKillEntry = { ptyId: string; intent: SshPendingPtyKill }

/** Newest-first, TTL-filtered and capped — the same shape as `pruneClosedTerminalTabTombstones`. */
export function prunePendingSshPtyKills(
  entries: readonly SshPendingPtyKillEntry[],
  now: number
): SshPendingPtyKillEntry[] {
  return entries
    .filter((entry) => !isSshPendingPtyKillExpired(entry.intent, now))
    .sort((a, b) => b.intent.requestedAt - a.intent.requestedAt)
    .slice(0, MAX_SSH_PENDING_PTY_KILLS_PER_TARGET)
}

/** Reads across every lease state on purpose: a kill issued while the provider was already gone
 *  tombstones its lease `terminated` and still leaves the remote process running. */
export function pendingSshPtyKillEntries(
  leases: readonly SshRemotePtyLease[]
): SshPendingPtyKillEntry[] {
  const entries: SshPendingPtyKillEntry[] = []
  for (const lease of leases) {
    if (lease.pendingKill) {
      entries.push({ ptyId: lease.ptyId, intent: lease.pendingKill })
    }
  }
  return entries
}
