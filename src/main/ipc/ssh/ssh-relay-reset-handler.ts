import { isLiveSshPtyLease } from '../../../shared/remote-runtime/ssh/ssh-types'
import { toAppSshPtyId } from '../../../shared/remote-runtime/ssh/ssh-pty-id'
import { rotateSshProviderAuthority } from '../../ssh/connection/authority/ssh-provider-authority'
import { forceStopRelayForTarget } from '../../ssh/ssh-relay-reset'
import { keepCustomizedRelayOnConnect } from '../../ssh/ssh-host-managed-policy'
import { getSshTargetRegistryStore } from '../../ssh/targets/ssh-target-registry'
import { clearProviderPtyState, deletePtyOwnership, getPtyIdsForConnection } from '../pty'
import { activeSessions } from './ssh-active-relay-sessions'
import {
  assertSshConnectsNotFenced,
  connectInFlight,
  credentialRequestedForTarget,
  resetRelayInFlight
} from './ssh-connect-attempt-registry'
import { connectionManager, persistedStore } from './ssh-ipc-context'
import { teardownActiveSshSession } from './ssh-session-teardown'
import { runTargetLifecycle } from './ssh-target-lifecycle-queue'

async function doResetRelay(targetId: string): Promise<void> {
  const target = getSshTargetRegistryStore()?.getTarget(targetId)
  if (!target || !keepCustomizedRelayOnConnect(target)) {
    throw new Error(`SSH target "${targetId}" has no direct relay to reset`)
  }
  const inFlightConnect = connectInFlight.get(targetId)
  if (inFlightConnect) {
    try {
      // Why: resetting activeSessions mid-deploy would dispose the session doConnect will use.
      await inFlightConnect.promise
    } catch {
      // The reset can still recover a stale remote relay after a failed connect.
    }
  }

  rotateSshProviderAuthority(targetId)
  const session = activeSessions.get(targetId)
  if (session) {
    // Why: detach() not dispose() — reset has its own stale-lease semantics below that dispose()'s clean-termination recording would hide.
    await teardownActiveSshSession(targetId, (capturedSession) =>
      capturedSession.detachAndPersist()
    )
  }

  const existingConn = connectionManager!.getConnection(targetId)
  let conn = existingConn
  if (!conn) {
    // Why re-check: admission fenced this reset before it parked on the in-flight connect, so shutdown
    // may have started (and drained) while we waited — opening a transport now would outlive the drain.
    assertSshConnectsNotFenced()
    conn = await connectionManager!.connect(target)
  }
  let relayStopAcknowledged = false
  try {
    await forceStopRelayForTarget(conn, targetId)
    relayStopAcknowledged = true
  } finally {
    const ptyIds = new Set(getPtyIdsForConnection(targetId))
    for (const lease of persistedStore!.getSshRemotePtyLeases(targetId)) {
      // Deliberately the raw state, not `sshRemotePtyLeaseAllowsReattach`: this asks which routes
      // the force-stop just invalidated, not which leases may be reattached. An already-`expired`
      // lease has no route left for reset to retire — re-marking it `expired` is a no-op write, and
      // any local handle this connection really holds arrives through `getPtyIdsForConnection`
      // above, whatever the lease says. Reset also may not upgrade it to `terminated`: killing the
      // relay daemon makes its PTYs permanently unreachable, which is not evidence they exited
      // (docs/reference/ssh-execution-boundary.md). Nothing here can adopt a stranger either — the
      // replacement relay namespaces every id under a fresh mint epoch, so an old orphan lease can
      // only fail its next reattach.
      if (isLiveSshPtyLease(lease)) {
        ptyIds.add(lease.ptyId)
        // Why: only a host-acknowledged force-stop may retire a lease. When it threw we never
        // observed those shells, so expiring them would record a verdict we do not hold; mirrors
        // ssh:terminateSessions, and the next connect re-attaches (or expires) them on evidence.
        if (relayStopAcknowledged) {
          persistedStore!.markDirectSshRemotePtyLease(targetId, lease.ptyId, 'expired')
        }
      }
    }
    // Why: reset force-kills the remote relay, so every local PTY handle it owned is stale even if the reset command failed after SIGTERM.
    for (const ptyId of ptyIds) {
      const appPtyId = toAppSshPtyId(targetId, ptyId)
      clearProviderPtyState(appPtyId)
      deletePtyOwnership(appPtyId)
    }
    // Why: reset's connect() may trip onCredentialRequest; clear so a later non-prompting doConnect doesn't persist lastRequiredPassphrase=true.
    credentialRequestedForTarget.delete(targetId)
    await connectionManager!.disconnect(targetId)
  }
}

export function resetDirectSshRelay(targetId: string): Promise<void> {
  const existing = resetRelayInFlight.get(targetId)
  if (existing) {
    return existing
  }
  assertSshConnectsNotFenced()
  const attempt = runTargetLifecycle(targetId, () => doResetRelay(targetId)).finally(() => {
    if (resetRelayInFlight.get(targetId) === attempt) {
      resetRelayInFlight.delete(targetId)
    }
  })
  resetRelayInFlight.set(targetId, attempt)
  return attempt
}
