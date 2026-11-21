import { serializePortForwardChange } from './ssh-managed-port-forward-restore'
import type { SshRelaySession } from '../../ssh/ssh-relay-session'
import { rotateSshProviderAuthority } from '../../ssh/connection/authority/ssh-provider-authority'
import { getSshTargetRegistryStore } from '../../ssh/targets/ssh-target-registry'
import { activeSessions } from './ssh-active-relay-sessions'
import { testingTargets } from './ssh-connect-attempt-registry'
import { relayGracePeriodForTarget } from './ssh-connection-state-callbacks'
import {
  connectionManager,
  currentRuntime,
  getCurrentMainWindow,
  persistedStore,
  portForwardManager
} from './ssh-ipc-context'
import { restorePortForwards } from './ssh-port-forward-persistence'
import {
  clearRelayLostBackoff,
  RELAY_LOST_BASE_DELAY_MS,
  RELAY_LOST_MAX_ATTEMPTS,
  RELAY_LOST_MAX_DELAY_MS,
  RELAY_LOST_STABILIZED_MS,
  relayLostBackoff,
  TRANSPORT_TERMINAL_STATUSES
} from './ssh-relay-lost-backoff'
import {
  broadcastDetectedPortsFromCurrentWindow,
  broadcastSshState,
  clearRelayStateOverride,
  connectionSupportsFolderDownload,
  publishRelayOverride
} from './ssh-renderer-broadcast'

export function configureRelaySessionCallbacks(session: SshRelaySession): void {
  const owns = (targetId: string): boolean => activeSessions.get(targetId) === session
  session.setOnTerminalRelayError((tid, err) => {
    if (!owns(tid)) {
      return
    }
    clearRelayLostBackoff(tid)
    if (activeSessions.get(tid)?.getState() !== 'deploying') {
      rotateSshProviderAuthority(tid)
    }
    console.warn(
      `[ssh] Terminal relay error for ${tid}: ${err.message}; skipping reconnect backoff.`
    )
    publishRelayOverride(tid, 'error', err.message, 0)
  })

  session.setOnRelayLost((tid) => {
    if (!owns(tid)) {
      return
    }
    const s = activeSessions.get(tid)
    if (!s) {
      return
    }
    const c = connectionManager?.getConnection(tid)
    if (!c) {
      return
    }
    const t = getSshTargetRegistryStore()?.getTarget(tid)
    const persistentReconnect = (t?.reconnectOnLaunch ?? t?.connectOnStartup) !== false

    // Why: bounded exponential backoff — without it, a remote bug that closes every fresh --connect channel becomes an infinite relay-deploy loop.
    const state = relayLostBackoff.get(tid) ?? {
      attempts: 0,
      reconnectTimer: null,
      stabilizedTimer: null
    }
    if (state.stabilizedTimer) {
      clearTimeout(state.stabilizedTimer)
      state.stabilizedTimer = null
    }
    if (state.reconnectTimer) {
      return
    }
    rotateSshProviderAuthority(tid)

    // Why: re-deploying the relay rides the SSH transport, so while the transport is itself down no attempt
    // can succeed. Waiting at the max delay without consuming the budget keeps a flapping host off the
    // manual-reconnect banner, which would tell the user to act on a link that is still auto-recovering.
    const transportStatus = connectionManager?.getState(tid)?.status
    const transportConnected = transportStatus === 'connected'
    if (transportConnected && !persistentReconnect && state.attempts >= RELAY_LOST_MAX_ATTEMPTS) {
      console.warn(
        `[ssh] Relay channel for ${tid} kept dying across ${state.attempts} attempts; giving up. User must reconnect manually.`
      )
      relayLostBackoff.delete(tid)
      // Why: surface the failure — a live SSH connection with a dead relay is otherwise invisible (typing in remote terminals just stops working).
      publishRelayOverride(
        tid,
        'error',
        'Relay channel kept dropping. Click Reconnect on the SSH target before retrying.',
        0
      )
      return
    }

    const scheduleRelayRedeploy = (delay: number, attemptCharged: boolean): void => {
      state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null
        relayLostBackoff.set(tid, state)
        const liveConn = connectionManager?.getConnection(tid)
        if (!liveConn || !owns(tid)) {
          clearRelayLostBackoff(tid)
          return
        }
        const status = connectionManager?.getState(tid)?.status
        if (status === 'connected') {
          if (!attemptCharged) {
            // Why: waiting is free, but the deploy it defers is real — charge it here so a transport that
            // flaps back to 'connected' can't redeploy forever on an uncharged budget.
            state.attempts = Math.min(state.attempts + 1, RELAY_LOST_MAX_ATTEMPTS)
          }
          void s.reconnect(liveConn, relayGracePeriodForTarget(t))
          return
        }
        if (status === undefined || TRANSPORT_TERMINAL_STATUSES.has(status)) {
          // Why: the transport gave up for good; its own state is what the user acts on, so stop waiting for a redeploy that can never run.
          clearRelayLostBackoff(tid)
          return
        }
        // Why: still mid-transition — re-arm at the max delay without consuming an attempt. It ends once
        // the transport settles: 'connected' redeploys, a terminal status or a dropped session clears above.
        scheduleRelayRedeploy(RELAY_LOST_MAX_DELAY_MS, false)
      }, delay)
      relayLostBackoff.set(tid, state)
    }

    if (!transportConnected) {
      publishRelayOverride(
        tid,
        'reconnecting',
        'Relay channel lost. Reconnecting...',
        state.attempts
      )
      scheduleRelayRedeploy(RELAY_LOST_MAX_DELAY_MS, false)
      console.warn(
        `[ssh] Relay channel for ${tid} lost while the SSH transport is ${transportStatus ?? 'unknown'}; waiting ${RELAY_LOST_MAX_DELAY_MS}ms without consuming an attempt`
      )
      return
    }

    const delay = Math.min(RELAY_LOST_BASE_DELAY_MS * 2 ** state.attempts, RELAY_LOST_MAX_DELAY_MS)
    state.attempts = Math.min(state.attempts + 1, RELAY_LOST_MAX_ATTEMPTS)
    publishRelayOverride(tid, 'reconnecting', 'Relay channel lost. Reconnecting...', state.attempts)
    scheduleRelayRedeploy(delay, true)
    console.warn(
      `[ssh] Relay channel for ${tid} lost; reconnect attempt ${state.attempts}/${RELAY_LOST_MAX_ATTEMPTS} in ${delay}ms`
    )
  })

  // Why: fires after both establish() and reconnect() reach 'ready'; re-create persisted port forwards so they survive restarts and blips.
  session.setOnReady((tid) => {
    if (!owns(tid)) {
      return
    }
    const state = relayLostBackoff.get(tid)
    if (state) {
      if (state.stabilizedTimer) {
        clearTimeout(state.stabilizedTimer)
      }
      // Why: stabilization counts post-ready uptime; slow deploy time before `ready` doesn't prove the new relay survived real work.
      state.stabilizedTimer = setTimeout(() => {
        const current = relayLostBackoff.get(tid)
        if (current === state && !current.reconnectTimer) {
          relayLostBackoff.delete(tid)
        }
      }, RELAY_LOST_STABILIZED_MS)
      relayLostBackoff.set(tid, state)
    }
    if (!testingTargets.has(tid)) {
      clearRelayStateOverride(tid)
      broadcastSshState(tid, {
        targetId: tid,
        status: 'connected',
        error: null,
        reconnectAttempt: 0,
        supportsFolderDownload: connectionSupportsFolderDownload(tid)
      })
    }
    currentRuntime?.notifySshRelayReady?.(tid)
    void serializePortForwardChange(tid, () => restorePortForwards(tid)).catch((error: unknown) =>
      console.warn(`[ssh] Could not restore relay port forwards for ${tid}:`, error)
    )
  })
}

export function refreshActiveRelaySessions(): void {
  if (!persistedStore || !portForwardManager) {
    return
  }
  for (const session of activeSessions.values()) {
    session.refreshEnvironment(
      getCurrentMainWindow,
      persistedStore,
      portForwardManager,
      currentRuntime,
      broadcastDetectedPortsFromCurrentWindow
    )
    configureRelaySessionCallbacks(session)
  }
}
