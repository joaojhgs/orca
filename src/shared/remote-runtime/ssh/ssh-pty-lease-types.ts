import type { SshPendingPtyKill } from './ssh-pending-pty-kill'

export type SshRemotePtyLeaseState = 'attached' | 'detached' | 'terminated' | 'expired'

export type SshRemotePtyLease = {
  targetId: string
  ptyId: string
  worktreeId?: string
  tabId?: string
  leafId?: string
  state: SshRemotePtyLeaseState
  createdAt: number
  updatedAt: number
  lastAttachedAt?: number
  lastDetachedAt?: number
  /** Client-local unconfirmed stop for replay to the same target; see ssh-pending-pty-kill.ts. Never sent on the wire. */
  pendingKill?: SshPendingPtyKill
  /** Stored-form winning lease ID, written by supersession; live upserts clear it so recycled IDs cannot inherit the mark. */
  supersededBy?: string
  /** Pending-stop replay proved a different incarnation owns this ID (relay-id-recycled); never reattach this lease. */
  relayIdRecycled?: true
}

/** Attached/detached still claim a running terminal; expired lost its route, while only terminated proves exit. */
export function isLiveSshPtyLease(lease: Pick<SshRemotePtyLease, 'state'>): boolean {
  return lease.state === 'attached' || lease.state === 'detached'
}

/** Expired means lost client route, never proven remote exit (ssh-execution-boundary.md).
 * Superseded/recycled marks prove this route unusable; unmarked orphans may reattach to discover whether the shell survived. */
export function sshRemotePtyLeaseAllowsReattach(
  lease: Pick<SshRemotePtyLease, 'state' | 'supersededBy' | 'relayIdRecycled'>
): boolean {
  return (
    lease.state !== 'terminated' &&
    (lease.state !== 'expired' ||
      (lease.supersededBy === undefined && lease.relayIdRecycled !== true))
  )
}

/** Main-owned relay lease needed to reclaim PTY delivery after a desktop restart. */
export type SshPtyConsumerRecovery = {
  targetId: string
  clientInstanceId: string
  serverBuildId: string
  clientGeneration: number
  ownerGeneration: number
  ownerLease: string
  outputFlowControl?: {
    version: 1
    windowSu: number
  }
}
