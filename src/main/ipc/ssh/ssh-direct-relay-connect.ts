import type {
  DirectSshAuthority,
  SshConnectionState,
  SshTarget
} from '../../../shared/remote-runtime/ssh/ssh-types'
import { createCancelledConnectAttemptError } from '../../ssh/connection/reconnect/ssh-connect-attempt-cancellation'
import { runAttributedToSshOwner } from '../../ssh/connection/ssh-connection-attribution'
import { clearSshHostServerStatus } from '../../ssh/host-server/ssh-host-server-status'
import { keepCustomizedRelayOnConnect } from '../../ssh/ssh-host-managed-policy'
import { getSshTargetRegistryStore } from '../../ssh/targets/ssh-target-registry'
import { activeSessions } from './ssh-active-relay-sessions'
import { assertSshConnectsNotFenced, isCurrentConnectAttempt } from './ssh-connect-attempt-registry'
import { publishHostServerDecisionFailure } from './ssh-host-server-connect'
import {
  connectionManager,
  currentRuntime,
  getCurrentMainWindow,
  persistedStore,
  portForwardManager
} from './ssh-ipc-context'
import { configureRelaySessionCallbacks } from './ssh-relay-session-callbacks'
import {
  broadcastDetectedPortsFromCurrentWindow,
  broadcastSshState,
  getPublicSshState,
  publishRelayOverride,
  relayStateOverrides
} from './ssh-renderer-broadcast'
import { abandonDecisionTransport, teardownActiveSshSession } from './ssh-session-teardown'

function getLiveDirectRelayState(targetId: string): SshConnectionState | undefined {
  const session = activeSessions.get(targetId)
  if (
    session?.getState() !== 'ready' ||
    relayStateOverrides.has(targetId) ||
    connectionManager?.getState(targetId)?.status !== 'connected'
  ) {
    return undefined
  }
  const mux = session.getMux()
  if (mux ? mux.isDisposed() : !session.getPlainSshSession()) {
    return undefined
  }
  return getPublicSshState(targetId)
}

export async function connectDirectRelay(
  target: SshTarget,
  authority: DirectSshAuthority
): Promise<SshConnectionState> {
  const targetId = target.id
  const { SshRelaySession } = await import('../../ssh/ssh-relay-session')
  await teardownActiveSshSession(targetId, (session) => session.detachAndPersist())
  assertSshConnectsNotFenced()
  if (!isCurrentConnectAttempt(targetId, authority)) {
    throw createCancelledConnectAttemptError()
  }
  const currentTarget = getSshTargetRegistryStore()?.getTarget(targetId)
  if (!currentTarget || !keepCustomizedRelayOnConnect(currentTarget)) {
    throw createCancelledConnectAttemptError()
  }
  clearSshHostServerStatus(targetId)
  const owner = Symbol(targetId)
  const session = new SshRelaySession(
    targetId,
    getCurrentMainWindow,
    persistedStore!,
    portForwardManager!,
    currentRuntime,
    broadcastDetectedPortsFromCurrentWindow
  )
  configureRelaySessionCallbacks(session)
  activeSessions.set(targetId, session)
  const ownsSession = (): boolean =>
    isCurrentConnectAttempt(targetId, authority) && activeSessions.get(targetId) === session

  try {
    const connection = await runAttributedToSshOwner(owner, () =>
      connectionManager!.connect(currentTarget)
    )
    if (!ownsSession()) {
      throw createCancelledConnectAttemptError()
    }
    publishRelayOverride(targetId, 'deploying-relay', null, 0)
    await session.establish(connection, currentTarget.relayGracePeriodSeconds)
    if (!ownsSession()) {
      throw createCancelledConnectAttemptError()
    }
  } catch (error) {
    const current = ownsSession()
    if (activeSessions.get(targetId) === session) {
      await teardownActiveSshSession(targetId, (relay) => relay.detachAndPersist()).catch(
        (detachError: unknown) =>
          console.warn(`[ssh] Failed to detach relay after connecting ${targetId}:`, detachError)
      )
    }
    await abandonDecisionTransport(targetId, owner, authority)
    if (!current || !isCurrentConnectAttempt(targetId, authority)) {
      throw createCancelledConnectAttemptError()
    }
    publishHostServerDecisionFailure(targetId, error, (id, state) =>
      publishRelayOverride(id, state.status, state.error, state.reconnectAttempt)
    )
    throw error
  }

  // Establish's ready callback publishes the same state for fresh connects and reconnects.
  return getPublicSshState(targetId)!
}

export function republishLiveDirectRelay(targetId: string): SshConnectionState | undefined {
  const state = getLiveDirectRelayState(targetId)
  if (state) {
    broadcastSshState(targetId, state)
  }
  return state
}
