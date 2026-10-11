/**
 * Desktop delivery policy for dispatched notifications.
 *
 * Lifted out of the `notifications:dispatch` IPC closure so the ordering that matters —
 * tray attention before the gates, mobile fan-out before the desktop early returns — is
 * expressed once against injected collaborators instead of ambient Electron singletons.
 */
import type { BrowserWindow } from 'electron'
import type {
  NotificationDispatchRequest,
  NotificationDispatchResult,
  NotificationSettings
} from '../../shared/notification-settings-types'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { buildNotificationOptions } from '../ipc/notification-options'
import { translateMain } from '../i18n/main-i18n'
import { reserveNotificationCooldown } from '../ipc/notification-burst-cooldown'
import {
  resolveNotificationScopePolicy,
  type NotificationPolicyScope
} from '../../shared/notification-scope-policy'
import { notificationPolicyKind } from '../../shared/notification-policy-kind'

export type NotificationDeliveryDependencies = {
  readNotificationSettings: () => NotificationSettings
  /** The window the user would see the banner on, or null when none is open. */
  findActiveWindow: () => BrowserWindow | null
  isWindowVisible: (window: BrowserWindow | null) => boolean
  setTrayAttention: (attention: boolean) => void
  isNotificationSupported: () => boolean
  /** Null when no runtime is paired, so mobile fan-out is skipped entirely. */
  dispatchMobileNotification: OrcaRuntimeService['dispatchMobileNotification'] | null
  readAuthorizationStatus: () => Promise<
    'authorized' | 'denied' | 'not-determined' | 'unknown' | null
  >
  recordDeliveryOutcome: (outcome: 'delivered' | 'failed') => void
  deliverNative: (
    request: NotificationDispatchRequest,
    options: ReturnType<typeof buildNotificationOptions>,
    settings: NotificationSettings
  ) => NotificationDispatchResult | Promise<NotificationDispatchResult>
  platform: NodeJS.Platform
  now: () => number
  /** Told once per path that actually announced the request: a desktop banner shown, or a mobile alert sent. */
  recordAnnounced?: (request: NotificationDispatchRequest) => void
  /** Shared main-agent stop policy runs before tray, mobile, cooldown, or native side effects. */
  confirmStopPoint?: (request: NotificationDispatchRequest) => Promise<boolean>
  readPolicyScope?: (request: NotificationDispatchRequest) => NotificationPolicyScope
}

export type NotificationDeliveryService = {
  dispatch: (
    request: NotificationDispatchRequest
  ) => NotificationDispatchResult | Promise<NotificationDispatchResult>
}

export function createNotificationDeliveryService(
  deps: NotificationDeliveryDependencies
): NotificationDeliveryService {
  const recentDesktopNotifications = new Map<string, number>()
  const recentMobileNotifications = new Map<string, number>()

  // Keyed news is announced once by its producer, so only its own repeat may collapse it.
  const dedupeKeyFor = (request: NotificationDispatchRequest): string =>
    request.attentionKey ?? request.worktreeId ?? request.worktreeLabel ?? 'global'

  const deliverNativeAndRecord = (
    request: NotificationDispatchRequest,
    options: ReturnType<typeof buildNotificationOptions>,
    settings: NotificationSettings
  ): NotificationDispatchResult | Promise<NotificationDispatchResult> => {
    const policySilent = options.silent === true
    const recordIfDelivered = (result: NotificationDispatchResult): NotificationDispatchResult => {
      if (result.delivered) {
        deps.recordAnnounced?.(request)
      }
      return policySilent ? { ...result, silent: true } : result
    }
    const result = deps.deliverNative(request, options, settings)
    return result instanceof Promise ? result.then(recordIfDelivered) : recordIfDelivered(result)
  }

  const dispatch: NotificationDeliveryService['dispatch'] = (request) => {
    const settings = deps.readNotificationSettings()
    const scope = deps.readPolicyScope?.(request) ?? request.notificationScope ?? {}
    const kind = notificationPolicyKind(request)
    const desktopPolicy = resolveNotificationScopePolicy(
      settings.scopePolicy,
      scope,
      kind,
      'desktop'
    )
    const mobilePolicy = resolveNotificationScopePolicy(settings.scopePolicy, scope, kind, 'mobile')
    // Why: light the tray attention dot before the cooldown/focus/enabled gates so they
    // can't hold it back (clears on window show/restore; see index.ts).
    if (
      desktopPolicy.human &&
      (request.source === 'agent-task-complete' || request.source === 'terminal-bell')
    ) {
      if (!deps.isWindowVisible(deps.findActiveWindow())) {
        deps.setTrayAttention(true)
      }
    }

    const hostMuted =
      request.notificationSourceId !== undefined &&
      settings.mutedNotificationSourceIds.includes(request.notificationSourceId)
    // Machine mutes leave mobile eligibility and its cooldown unchanged.
    const desktopAllowed =
      settings.enabled &&
      (request.source !== 'agent-task-complete' || settings.agentTaskComplete) &&
      (request.source !== 'terminal-bell' || settings.terminalBell)

    const notificationOptions = buildNotificationOptions(request, translateMain)
    if (desktopPolicy.delivery === 'silent') {
      notificationOptions.silent = true
    }

    // Why: desktop focus only means this computer sees the worktree; the paired phone may still need the alert.
    if (
      !request.mobileDeliveredByHost &&
      (mobilePolicy.human || desktopPolicy.human) &&
      deps.dispatchMobileNotification &&
      request.source !== 'test'
    ) {
      if (
        reserveNotificationCooldown(
          recentMobileNotifications,
          JSON.stringify([
            desktopAllowed,
            request.source,
            request.agentState,
            dedupeKeyFor(request)
          ]),
          deps.now()
        )
      ) {
        deps.dispatchMobileNotification({
          type: 'notification',
          emittedAt: deps.now(),
          source: request.source,
          notificationScope: scope,
          notificationKind: kind,
          ...(!desktopAllowed || !desktopPolicy.human ? { desktopAllowed: false } : {}),
          title: notificationOptions.title,
          body: notificationOptions.body,
          worktreeId: request.worktreeId,
          ...(request.notificationId ? { notificationId: request.notificationId } : {}),
          // Why: background push needs the agent's real state to pick "needs input"
          // vs "finished" — and to stay silent while the agent is still working.
          ...(request.agentState ? { agentState: request.agentState } : {}),
          ...(request.attentionKey ? { attentionKey: request.attentionKey } : {}),
          ...(request.structuredOrigin ? { structuredOrigin: request.structuredOrigin } : {})
        })
        deps.recordAnnounced?.(request)
      }
    }

    if (!desktopAllowed || hostMuted || !desktopPolicy.human) {
      return {
        delivered: false,
        reason: !desktopPolicy.human
          ? 'policy-muted'
          : !settings.enabled
            ? 'disabled'
            : hostMuted
              ? 'host-muted'
              : 'source-disabled'
      }
    }

    const browserWindow = deps.findActiveWindow()
    if (
      settings.suppressWhenFocused &&
      request.isActiveWorktree &&
      browserWindow &&
      browserWindow.isFocused()
    ) {
      return { delivered: false, reason: 'suppressed-focus' }
    }

    // Why: the Settings test button is an explicit, often-repeated user action, so it bypasses burst dedupe.
    if (request.source !== 'test') {
      // Dedupe by worktree, not source — agent-finish and terminal-bell often fire in one chunk; surface only the first.
      if (
        !reserveNotificationCooldown(recentDesktopNotifications, dedupeKeyFor(request), deps.now())
      ) {
        return { delivered: false, reason: 'cooldown' }
      }
    }

    if (!deps.isNotificationSupported()) {
      return { delivered: false, reason: 'not-supported' }
    }

    if (deps.platform !== 'darwin') {
      return deliverNativeAndRecord(request, notificationOptions, settings)
    }
    // Why: macOS silently swallows notifications while permission is denied/undecided (verified macOS 26); skip so the renderer can show a fallback.
    return deps.readAuthorizationStatus().then((authorization) => {
      if (authorization === 'denied' || authorization === 'not-determined') {
        deps.recordDeliveryOutcome('failed')
        return { delivered: false, reason: 'blocked-by-system' }
      }
      return deliverNativeAndRecord(request, notificationOptions, settings)
    })
  }
  return {
    dispatch: (request) =>
      deps.confirmStopPoint && request.source !== 'test'
        ? deps
            .confirmStopPoint(request)
            .then((confirmed): NotificationDispatchResult | Promise<NotificationDispatchResult> =>
              confirmed ? dispatch(request) : { delivered: false, reason: 'invalid-request' }
            )
        : dispatch(request)
  }
}
