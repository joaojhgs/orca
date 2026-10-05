import { connectRegisteredSshTarget } from '../ssh/ssh-target-registry'
import { isAuthError } from '../ssh/ssh-connection-utils'
import type { SshConnectionStore } from '../ssh/ssh-connection-store'

export function reconnectHeadlessSshTargets(
  store: Pick<SshConnectionStore, 'listTargets' | 'getTarget'>
): void {
  for (const target of store.listTargets()) {
    if (target.connectOnStartup === false || target.lastRequiredPassphrase === true) {
      continue
    }
    void (async () => {
      let attempt = 0
      for (;;) {
        const current = store.getTarget(target.id)
        if (
          !current ||
          current.connectOnStartup === false ||
          current.lastRequiredPassphrase === true
        ) {
          return
        }
        try {
          await connectRegisteredSshTarget(target.id)
          console.info(`[serve] SSH target ${current.label} connected automatically`)
          return
        } catch (error) {
          const errorObject = error instanceof Error ? error : new Error(String(error))
          if (isAuthError(errorObject)) {
            console.warn(
              `[serve] SSH target ${current.label} needs interactive authentication; automatic retry paused`
            )
            return
          }
          const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5))
          attempt += 1
          console.warn(
            `[serve] SSH target ${current.label} did not auto-connect (attempt ${attempt}); retrying in ${delay}ms:`,
            errorObject.message
          )
          await new Promise<void>((resolve) => setTimeout(resolve, delay))
        }
      }
    })()
  }
}
