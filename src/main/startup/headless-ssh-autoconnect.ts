import { connectRegisteredSshTarget } from '../ssh/targets/ssh-target-registry'
import { isAuthError } from '../ssh/ssh-connection-utils'
import type { SshConnectionStore } from '../ssh/targets/ssh-connection-store'

export function reconnectHeadlessSshTargets(
  store: Pick<SshConnectionStore, 'listTargets' | 'getTarget'>
): () => void {
  const controller = new AbortController()
  for (const target of store.listTargets()) {
    if (
      (target.reconnectOnLaunch ?? target.connectOnStartup) === false ||
      target.lastRequiredPassphrase === true
    ) {
      continue
    }
    void (async () => {
      let attempt = 0
      while (!controller.signal.aborted) {
        const current = store.getTarget(target.id)
        if (
          !current ||
          (current.reconnectOnLaunch ?? current.connectOnStartup) === false ||
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
          await waitForRetry(delay, controller.signal)
        }
      }
    })()
  }
  return () => controller.abort()
}

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, delay)
    timer.unref?.()
    if (signal.aborted) {
      finish()
    } else {
      signal.addEventListener('abort', finish, { once: true })
    }
  })
}
