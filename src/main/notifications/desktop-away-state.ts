import { DESKTOP_AWAY_SECONDS } from '../../shared/app-lifecycle/presence/desktop-away-threshold'

type IdleMonitor = {
  getSystemIdleState(threshold: number): string
  getSystemIdleTime(): number
}

export function readDesktopAwayState(monitor: IdleMonitor, headless = false): boolean | undefined {
  // Xvfb often reports idle=0 indefinitely. A server without a desktop window
  // cannot represent a user at the desktop and must not suppress phone alerts.
  if (headless) {
    return true
  }
  try {
    const state = monitor.getSystemIdleState(DESKTOP_AWAY_SECONDS)
    if (state === 'locked' || state === 'idle') {
      return true
    }
    const idle = monitor.getSystemIdleTime()
    return Number.isFinite(idle) && idle >= 0 ? idle >= DESKTOP_AWAY_SECONDS : undefined
  } catch {
    // Unknown presence must not silence a phone.
    return undefined
  }
}
