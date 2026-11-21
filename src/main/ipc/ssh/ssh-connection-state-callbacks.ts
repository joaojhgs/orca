import { rotateSshProviderAuthority } from '../../ssh/connection/authority/ssh-provider-authority'
import { activeSessions } from './ssh-active-relay-sessions'
import { clearRelayLostBackoff } from './ssh-relay-lost-backoff'
import type { SshConnectionCallbacks } from '../../ssh/connection/ssh-connection-callbacks'
import type { SshConnectionState } from '../../../shared/remote-runtime/ssh/ssh-types'
import { isSshHostCensusInFlight } from '../../ssh/connection/ssh-connection-attribution'
import {
  clearSshCredentialDeclined,
  isSshCredentialDeclined
} from '../../ssh/authentication/ssh-credential-decline'
import {
  connectInFlight,
  credentialRequestedForTarget,
  testingTargets
} from './ssh-connect-attempt-registry'
import { connectionManager } from './ssh-ipc-context'
import { getSshTargetRegistryStore } from '../../ssh/targets/ssh-target-registry'
import { recordSshSignInRequirement } from './ssh-sign-in-requirement'
import { restoreManagedHostPortForwards } from './ssh-managed-port-forward-restore'
import { requestCredential } from './ssh-passphrase'
import {
  broadcastSshState,
  clearRelayStateOverride,
  publishRelayOverride
} from './ssh-renderer-broadcast'

const pendingTransportReconnects = new Set<string>()

export function relayGracePeriodForTarget(
  target: { relayGracePeriodSeconds?: number } | null | undefined
): number | undefined {
  return target?.relayGracePeriodSeconds
}

export function handleSshConnectionStateChange(targetId: string, state: SshConnectionState): void {
  if (state.status === 'connected') {
    clearSshCredentialDeclined(targetId)
    recordSshSignInRequirement(targetId, getSshTargetRegistryStore(), connectionManager)
  }
  if (testingTargets.has(targetId)) {
    return
  }
  const session = activeSessions.get(targetId)
  const relayWasRunning = session?.getState() === 'ready' || session?.getState() === 'reconnecting'
  if (relayWasRunning && state.status === 'reconnecting') {
    if (!pendingTransportReconnects.has(targetId)) {
      rotateSshProviderAuthority(targetId)
      pendingTransportReconnects.add(targetId)
    }
    publishRelayOverride(targetId, 'reconnecting', state.error, state.reconnectAttempt)
    return
  }
  if (state.status === 'connected' && pendingTransportReconnects.delete(targetId)) {
    const conn = connectionManager?.getConnection(targetId)
    if (session && relayWasRunning && conn) {
      clearRelayLostBackoff(targetId)
      publishRelayOverride(
        targetId,
        'reconnecting',
        'Relay channel reconnecting...',
        state.reconnectAttempt
      )
      void session.reconnect(
        conn,
        relayGracePeriodForTarget(getSshTargetRegistryStore()?.getTarget(targetId))
      )
      return
    }
  }
  if (state.status === 'connected' && (relayWasRunning || session?.getState() === 'deploying')) {
    return
  }
  if (state.status !== 'connecting') {
    pendingTransportReconnects.delete(targetId)
    clearRelayStateOverride(targetId)
  }
  if (
    state.status === 'connected' &&
    (connectInFlight.has(targetId) || isSshHostCensusInFlight(targetId))
  ) {
    // Raw transport connected is premature while the host server decision is still pending.
    broadcastSshState(targetId, {
      targetId,
      status: session ? 'deploying-relay' : 'connecting',
      error: state.error,
      reconnectAttempt: state.reconnectAttempt
    })
    return
  }
  broadcastSshState(targetId, state)
  // An explicit connect restores through its own publish; this covers a transport that recovered.
  if (state.status === 'connected') {
    void restoreManagedHostPortForwards(targetId)
  }
}

export function createSshConnectionCallbacks(): SshConnectionCallbacks {
  return {
    onCredentialRequest: (targetId, kind, detail, echo, signal) => {
      // After Cancel, only explicit connects may prompt again.
      if (isSshCredentialDeclined(targetId, signal)) {
        return Promise.resolve(null)
      }
      credentialRequestedForTarget.add(targetId)
      return requestCredential(targetId, kind, detail, echo, signal)
    },
    onStateChange: handleSshConnectionStateChange
  }
}
