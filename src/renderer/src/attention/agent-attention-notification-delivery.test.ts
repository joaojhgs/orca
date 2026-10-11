import { afterEach, expect, it, vi } from 'vitest'
import { deliverAgentAttentionNotification } from './agent-attention-notification-delivery'
import { playDesktopNotificationSound } from '@/lib/desktop-notification-sound'

vi.mock('@/lib/desktop-notification-sound', () => ({ playDesktopNotificationSound: vi.fn() }))
vi.mock('@/lib/blocked-notification-fallback', () => ({
  showBlockedNotificationFallbackToast: vi.fn()
}))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
it.each([true, false])(
  'honors the server silent result (%s) for custom sound playback',
  async (silent) => {
    vi.stubGlobal('window', {
      api: {
        notifications: {
          dispatch: vi.fn(async () => ({ delivered: true, ...(silent ? { silent: true } : {}) }))
        }
      }
    })
    deliverAgentAttentionNotification(
      { source: 'agent-task-complete' },
      { customSoundId: 'bong', customSoundVolume: 50 }
    )
    await new Promise((resolve) => setImmediate(resolve))
    expect(playDesktopNotificationSound).toHaveBeenCalledTimes(silent ? 0 : 1)
  }
)
