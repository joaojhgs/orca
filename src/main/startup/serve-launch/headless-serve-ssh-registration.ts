import { app } from 'electron'
import type { Store } from '../../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { reconnectHeadlessSshTargets } from '../headless-ssh-autoconnect'
import { registerSshHandlers } from '../../ipc/ssh/ssh'
import { mainProcessState as state } from '../main-process-state'

/** Register SSH before any window so headless serve can list/connect targets (#25886, #8489); later window registration is idempotent. */
export async function registerHeadlessServeSshHandlers(
  store: Store,
  runtime: OrcaRuntimeService
): Promise<void> {
  const { sshStore } = await registerSshHandlers(store, () => state.mainWindow ?? null, runtime)
  app.once('will-quit', reconnectHeadlessSshTargets(sshStore))
}
