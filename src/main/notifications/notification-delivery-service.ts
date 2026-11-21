import { startDesktopNotificationDigestDelivery } from './desktop-notification-digest-delivery'
import type { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { NotificationDigestQueue } from './notification-digest-queue'
import { DesktopDigestPayloadSchema, notificationDigestKey } from './notification-digest-payload'
import {
  attentionOriginWasRead,
  type StructuredAttentionRead
} from '../../shared/agent-session/view/agent-session-attention'
import type {
  NotificationDispatchRequest,
  NotificationDispatchResult,
  NotificationSettings
} from '../../shared/notifications/notification-settings-types'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { buildNotificationOptions } from '../ipc/notifications/notification-options'
import { translateMain } from '../i18n/main-i18n'
import { reserveNotificationCooldown } from '../../shared/notifications/notification-burst-cooldown'
import { toHostSessionPaneKey } from '../../shared/workspace-layout/terminal-surface-id'
import { isNotificationSourceEnabled } from '../../shared/notifications/notification-source-gate'
import { notificationDeliveryId } from '../../shared/notifications/notification-delivery-id'
import {
  resolveNotificationScopePolicy,
  type NotificationPolicyScope
} from '../../shared/notification-scope-policy'
import { notificationPolicyKind } from '../../shared/notification-policy-kind'

// Set tray attention before gates and fan out to phones before desktop early returns.
type NativeNotificationReservation = {
  isCurrent: () => boolean
  release: () => void
}
export type NotificationDeliveryDependencies = {
  readNotificationSettings: () => NotificationSettings
  findActiveWindow: () => BrowserWindow | null
  isWindowVisible: (window: BrowserWindow | null) => boolean
  setTrayAttention: (attention: boolean) => void
  isNotificationSupported: () => boolean
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
  reserveNative?: (
    request: NotificationDispatchRequest
  ) => NativeNotificationReservation | undefined
  wasRead?: (request: NotificationDispatchRequest) => boolean
  /** Called for each actual desktop banner or mobile alert. */
  recordAnnounced?: (request: NotificationDispatchRequest) => void
  /** Shared main-agent stop policy runs before tray, mobile, cooldown, or native side effects. */
  confirmStopPoint?: (request: NotificationDispatchRequest) => Promise<boolean>
  readPolicyScope?: (request: NotificationDispatchRequest) => NotificationPolicyScope
  desktopDigestPath?: string
  confirmDigestRelevant?: (request: NotificationDispatchRequest) => Promise<boolean | null>
  /** Whether the chat behind a structured notification answers a Slack thread. */
  repliesInSlack?: (sessionId: string) => boolean
}

export type NotificationDeliveryService = {
  dispose(): void
  retireDigest(
    ids: readonly string[],
    paneKeys: readonly string[],
    reads: readonly StructuredAttentionRead[]
  ): void
  dispatch: (
    request: NotificationDispatchRequest
  ) => NotificationDispatchResult | Promise<NotificationDispatchResult>
}

export function createNotificationDeliveryService(
  deps: NotificationDeliveryDependencies
): NotificationDeliveryService {
  const recentDesktopNotifications = new Map<string, number>()
  const recentMobileNotifications = new Map<string, number>()
  const digestQueue = deps.desktopDigestPath
    ? new NotificationDigestQueue(deps.desktopDigestPath, DesktopDigestPayloadSchema, deps.now)
    : null

  // Keyed news is announced once by its producer, so only its own repeat may collapse it.
  const dedupeKeyFor = (request: NotificationDispatchRequest): string =>
    JSON.stringify([
      request.executionHost,
      request.attentionKey ?? request.worktreeId ?? request.worktreeLabel ?? 'global'
    ])

  const deliverNativeAndRecord = (
    request: NotificationDispatchRequest,
    options: ReturnType<typeof buildNotificationOptions>,
    settings: NotificationSettings,
    reservation?: NativeNotificationReservation
  ): NotificationDispatchResult | Promise<NotificationDispatchResult> => {
    const policySilent = options.silent === true
    const recordIfDelivered = (result: NotificationDispatchResult): NotificationDispatchResult => {
      if (result.delivered && reservation?.isCurrent() === false) {
        return { delivered: false, reason: 'already-read' }
      }
      if (result.delivered) {
        deps.recordAnnounced?.(request)
      }
      return policySilent ? { ...result, silent: true } : result
    }
    const result = deps.deliverNative(request, options, settings)
    return result instanceof Promise ? result.then(recordIfDelivered) : recordIfDelivered(result)
  }

  const dispatch = (
    request: NotificationDispatchRequest,
    digest?: { title: string; body: string }
  ): NotificationDispatchResult | Promise<NotificationDispatchResult> => {
    if (deps.wasRead?.(request)) {
      return { delivered: false, reason: 'already-read' }
    }
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
    const desktopAllowed = isNotificationSourceEnabled(settings, request.source, request.agentState)

    const sessionId = request.structuredOrigin?.sessionId
    const notificationOptions: ReturnType<typeof buildNotificationOptions> =
      digest ??
      buildNotificationOptions(
        sessionId && deps.repliesInSlack?.(sessionId)
          ? { ...request, agentRepliesInSlack: true }
          : request,
        translateMain
      )
    if (digest || desktopPolicy.delivery === 'silent') {
      notificationOptions.silent = true
    }

    // Why: desktop focus only means this computer sees the worktree; the paired phone may still need the alert.
    if (
      !request.mobileDeliveredByHost &&
      !digest &&
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
          ...(!desktopAllowed ? { desktopAllowed: false } : {}),
          title: notificationOptions.title,
          body: notificationOptions.body,
          worktreeId: request.worktreeId,
          ...(request.workspaceExecutionHostId !== undefined
            ? { workspaceExecutionHostId: request.workspaceExecutionHostId }
            : {}),
          ...(request.paneKey ? { paneKey: toHostSessionPaneKey(request.paneKey) } : {}),
          ...(request.executionHost ? { executionHost: request.executionHost } : {}),
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

    if (!digest && desktopPolicy.delivery === 'digest' && request.source !== 'test') {
      const queued =
        digestQueue?.enqueue(
          notificationDigestKey(scope, kind, 'desktop'),
          request.notificationId ?? randomUUID(),
          {
            request: { ...request, notificationScope: scope, notificationKind: kind },
            options: notificationOptions
          }
        ) ?? false
      return { delivered: false, reason: queued ? 'digest-queued' : 'digest-unavailable' }
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

    const reservation = deps.reserveNative?.(request)
    const deliverNative = () =>
      deliverNativeAndRecord(request, notificationOptions, settings, reservation)
    try {
      // macOS swallows denied/undecided notifications; allow the renderer fallback instead.
      const result =
        deps.platform !== 'darwin'
          ? deliverNative()
          : deps.readAuthorizationStatus().then((authorization) => {
              if (deps.wasRead?.(request) || reservation?.isCurrent() === false) {
                return { delivered: false, reason: 'already-read' } as const
              }
              if (authorization === 'denied' || authorization === 'not-determined') {
                deps.recordDeliveryOutcome('failed')
                return { delivered: false, reason: 'blocked-by-system' } as const
              }
              return deliverNative()
            })
      if (result instanceof Promise) {
        return result.finally(() => reservation?.release())
      }
      reservation?.release()
      return result
    } catch (error) {
      reservation?.release()
      throw error
    }
  }
  startDesktopNotificationDigestDelivery(digestQueue, deps, dispatch)
  return {
    dispose: () => digestQueue?.stop(),
    retireDigest: (ids, paneKeys, reads) => {
      try {
        digestQueue?.cancel(
          ({ request }) =>
            (request.notificationId !== undefined && ids.includes(request.notificationId)) ||
            (request.paneKey !== undefined &&
              paneKeys.includes(request.paneKey) &&
              (!request.structuredOrigin ||
                reads.some((read) => attentionOriginWasRead(request.structuredOrigin, read))))
        )
      } catch {
        console.warn('[notifications] Desktop digest dismissal could not be persisted')
      }
    },
    dispatch: (request) => {
      if (request.executionHost && request.notificationId) {
        request = {
          ...request,
          notificationId: notificationDeliveryId(request.notificationId, request.executionHost)
        }
      }
      return deps.confirmStopPoint && request.source !== 'test'
        ? deps
            .confirmStopPoint(request)
            .then((confirmed): NotificationDispatchResult | Promise<NotificationDispatchResult> =>
              confirmed ? dispatch(request) : { delivered: false, reason: 'invalid-request' }
            )
        : dispatch(request)
    }
  }
}
