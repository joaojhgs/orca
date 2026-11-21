import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { Store } from '../persistence/loading-store/store'
export async function activateBackendSsh(
  runtime: OrcaRuntimeService,
  profileStore: Store,
  registerCleanup: (cleanup: () => Promise<void>) => void
): Promise<void> {
  const { startSshApplication } = await import('../ssh/application/ssh-application')
  const { installLegacyRelayBridgeApplication } =
    await import('../ipc/ssh/ssh-host-server-on-connect-wiring')
  const { beginSshShutdown } = await import('../ipc/ssh/ssh-shutdown-drain')
  const sshContext = await import('../ipc/ssh/ssh-ipc-context')
  const { reconnectHeadlessSshTargets } = await import('../startup/headless-ssh-autoconnect')
  let stopSshReconnects: (() => void) | undefined
  registerCleanup(async () => {
    stopSshReconnects?.()
    await beginSshShutdown()
  })
  const { sshStore } = await startSshApplication({
    store: profileStore,
    runtime,
    register: () => {},
    beforeReady: () =>
      installLegacyRelayBridgeApplication({
        store: profileStore,
        runtime: () => runtime,
        connection: (targetId) => sshContext.connectionManager?.getConnection(targetId) ?? null
      })
  })
  stopSshReconnects = reconnectHeadlessSshTargets(sshStore)
}
