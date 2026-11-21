import { activeSessions } from './ssh-active-relay-sessions'
import { assertNotManagedServerHost } from './ssh-target-crud-handlers'
import { getSshHostServerStatus } from '../../ssh/host-server/ssh-host-server-status'
import type { RegisterSshRequest } from '../../ssh/application/ssh-application-requests'
import {
  setSshTargetRegistryHandlers,
  getSshTargetRegistryStore
} from '../../ssh/targets/ssh-target-registry'
import {
  assertSshConnectsNotFenced,
  connectInFlight,
  runSshTestConnectionProbe
} from './ssh-connect-attempt-registry'
import { connectTarget } from './ssh-connect-flow'
import { connectionManager } from './ssh-ipc-context'
import { getPublicSshState } from './ssh-renderer-broadcast'
import { disconnectSshHostForUser } from './ssh-host-user-disconnect'
import { errorMessage } from '../../../shared/errors/error-message'
import {
  clearSshCredentialDeclined,
  isSshCredentialDeclined
} from '../../ssh/authentication/ssh-credential-decline'

export function registerSshConnectionHandlers(handle: RegisterSshRequest): void {
  setSshTargetRegistryHandlers({
    connect: connectTarget,
    getState: (targetId: string) => getPublicSshState(targetId)
  })

  handle('ssh:connect', async (args: { targetId: string; automatic?: boolean }) => {
    return connectTarget(args.targetId, { automatic: args.automatic === true })
  })

  handle('ssh:disconnect', async (args: { targetId: string }) => {
    await disconnectSshHostForUser(args.targetId)
  })

  handle('ssh:resetRelay', async ({ targetId }: { targetId: string }) => {
    const { resetDirectSshRelay } = await import('./ssh-relay-reset-handler')
    return resetDirectSshRelay(targetId)
  })

  handle(
    'ssh:terminateSessions',
    async ({ targetId, forRemoval }: { targetId: string; forRemoval?: boolean }) => {
      const { terminateSshTargetSessions } = await import('./ssh-terminate-sessions')
      if (forRemoval) {
        assertNotManagedServerHost(targetId)
      }
      return terminateSshTargetSessions(targetId)
    }
  )

  handle('ssh:moveToManagedServer', async ({ targetId }: { targetId: string }) => {
    await connectTarget(targetId, { moveToManagedServer: true })
    const status = getSshHostServerStatus(targetId)
    return status?.kind === 'managed'
      ? { outcome: 'moved', environmentId: status.environmentId }
      : { outcome: 'stayed' }
  })

  handle('ssh:getState', (args: { targetId: string }) => {
    return getPublicSshState(args.targetId)
  })

  // Auto-connect callers need to avoid prompts when credentials were declined or are no longer cached.
  handle('ssh:needsPassphrasePrompt', (args: { targetId: string }) => {
    if (isSshCredentialDeclined(args.targetId)) {
      return true
    }
    const target = getSshTargetRegistryStore()!.getTarget(args.targetId)
    if (!target?.lastRequiredPassphrase) {
      return false
    }
    return !connectionManager!.hasCachedCredential(target)
  })

  handle('ssh:testConnection', async (args: { targetId: string }) => {
    const target = getSshTargetRegistryStore()!.getTarget(args.targetId)
    if (!target) {
      throw new Error(`SSH target "${args.targetId}" not found`)
    }
    clearSshCredentialDeclined(args.targetId)

    // Probe disconnect would tear down an active connect; join its attempt instead.
    const inFlight = connectInFlight.get(args.targetId)
    if (inFlight) {
      try {
        const state = await inFlight.promise
        return { success: true, state }
      } catch (err) {
        return { success: false, error: errorMessage(err) }
      }
    }

    if (activeSessions.has(args.targetId)) {
      return { success: true, state: getPublicSshState(args.targetId) }
    }

    // Track probe completion so shutdown can join its otherwise sessionless transport.
    const probe = runSshTestConnectionProbe(args.targetId, async () => {
      // Do not open probe transports after the shutdown drain.
      assertSshConnectsNotFenced()
      // Probing a user-disconnected host must leave it disconnected.
      const conn = await connectionManager!.connect(target, { probe: true })
      const state = conn.getState()
      await connectionManager!.disconnect(args.targetId)
      return state
    })
    try {
      return { success: true, state: await probe }
    } catch (err) {
      return { success: false, error: errorMessage(err) }
    }
  })
}
