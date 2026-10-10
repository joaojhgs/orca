import type { EnrichedAgentHookEventPayload } from '../agent-hooks/server/server-types'
import type { TerminalSideEffectBatch } from '../../shared/terminal-side-effect-facts'
import type {
  NotificationSettings,
  NotificationDispatchRequest
} from '../../shared/notification-settings-types'
import type { MobileNotificationDispatchEvent } from '../runtime/runtime-mobile-notification-controller'
import { agentMainAgentVerdict } from '../../shared/agent-main-agent-verdict'
import { buildNotificationOptions } from '../ipc/notification-options'
import { reserveNotificationCooldown } from '../../shared/notification-burst-cooldown'
import { AGENT_NOTIFICATION_QUIET_MS } from '../../shared/agent-notification-quiet-window'
import { isAgentStatusHeldOpenByChildWork } from '../../shared/agent-lead-status-fold'

type PendingNotification = {
  identity: string
  event: EnrichedAgentHookEventPayload
  timer: ReturnType<typeof setTimeout>
}
type PaneNotificationState = {
  working: boolean
  announced: string | null
  pending: PendingNotification | null
  sessionId?: string
  launchToken?: string
}

function isLiveNotificationEvidence(event: EnrichedAgentHookEventPayload): boolean {
  return !(
    event.isReplay ||
    event.restoredUnconfirmed ||
    event.providerSessionOnly ||
    event.retainedForLiveness
  )
}

function notificationCandidate(event: EnrichedAgentHookEventPayload, working: boolean) {
  const payload = event.payload
  const mainState = payload.mainAgent?.state ?? payload.state
  const needsInput = payload.state === 'waiting' || payload.state === 'blocked'
  const verdict = agentMainAgentVerdict(payload)
  const completion =
    mainState === 'done' &&
    !isAgentStatusHeldOpenByChildWork(payload) &&
    working &&
    !payload.sessionBoundary &&
    !['cancellation', 'superseded', 'unconfirmed', 'interruption'].includes(verdict ?? '')
  if (!completion && !needsInput) {
    return null
  }
  const state = needsInput ? payload.state : mainState
  const timestamp =
    payload.mainAgent?.state === state
      ? payload.mainAgent.stateStartedAt
      : state === 'done'
        ? (payload.turnCompletedAt ?? event.stateStartedAt)
        : event.stateStartedAt
  return { state, identity: `${state}:${timestamp}`, verdict }
}

// Consumes accepted host evidence, not renderer presence or output silence. It
// never synthesizes a completion from a disconnect, stale title, or process exit.
export function createHeadlessNotificationDelivery(deps: {
  enabled(): boolean
  settings(): NotificationSettings
  dispatch(event: MobileNotificationDispatchEvent): void
  getStatusSnapshot?(): EnrichedAgentHookEventPayload[]
  now?: () => number
}) {
  const paneStates = new Map<string, PaneNotificationState>()
  const cooldown = new Map<string, number>()
  const now = deps.now ?? Date.now
  const clearPending = (pane: PaneNotificationState) => {
    if (pane.pending) {
      clearTimeout(pane.pending.timer)
      pane.pending = null
    }
  }
  const send = (request: NotificationDispatchRequest) => {
    if (!deps.enabled()) {
      return
    }
    const settings = deps.settings()
    if (
      !settings.enabled ||
      (request.source === 'agent-task-complete'
        ? !settings.agentTaskComplete
        : !settings.terminalBell)
    ) {
      return
    }
    if (!reserveNotificationCooldown(cooldown, request.worktreeId ?? 'global', now())) {
      return
    }
    const options = buildNotificationOptions(request)
    deps.dispatch({
      type: 'notification',
      source: request.source,
      title: options.title,
      body: options.body,
      worktreeId: request.worktreeId,
      notificationId: request.notificationId,
      agentState: request.agentState,
      emittedAt: now(),
      desktopAway: true
    })
  }
  return {
    status(event: EnrichedAgentHookEventPayload) {
      if (!deps.enabled() || !isLiveNotificationEvidence(event)) {
        return
      }
      const payload = event.payload
      const key = `${event.connectionId ?? 'local'}:${event.paneKey}`
      const previous = paneStates.get(key) ?? {
        working: false,
        announced: null,
        pending: null
      }
      if (
        (event.providerSession?.id && previous.sessionId !== event.providerSession.id) ||
        (event.launchToken && previous.launchToken !== event.launchToken)
      ) {
        clearPending(previous)
        previous.working = false
        previous.announced = null
      }
      previous.sessionId = event.providerSession?.id ?? previous.sessionId
      previous.launchToken = event.launchToken ?? previous.launchToken
      const mainState = payload.mainAgent?.state ?? payload.state
      if (mainState === 'working' && payload.turnCompletedAt === undefined) {
        previous.working = true
      }
      const candidate = notificationCandidate(event, previous.working)
      if (!candidate || candidate.identity === previous.announced) {
        clearPending(previous)
        if (mainState === 'done' && payload.state === 'done') {
          previous.working = false
        }
      } else if (candidate.identity === previous.pending?.identity) {
        previous.pending.event = event
      } else {
        clearPending(previous)
        // Only settled host evidence may alert; resumed work cancels milestones and auto-approvals.
        const pending: PendingNotification = {
          identity: candidate.identity,
          event,
          timer: setTimeout(() => {
            previous.pending = null
            const latest = deps.getStatusSnapshot
              ? deps
                  .getStatusSnapshot()
                  .find(
                    (row) =>
                      row.paneKey === event.paneKey && row.connectionId === event.connectionId
                  )
              : pending.event
            if (
              !latest ||
              !isLiveNotificationEvidence(latest) ||
              latest.providerSession?.id !== pending.event.providerSession?.id ||
              latest.launchToken !== pending.event.launchToken
            ) {
              return
            }
            const settled = notificationCandidate(latest, previous.working)
            if (!settled || settled.identity !== pending.identity) {
              return
            }
            previous.announced = settled.identity
            if (settled.state === 'done') {
              previous.working = false
            }
            send({
              source: 'agent-task-complete',
              worktreeId: latest.worktreeId,
              worktreeLabel: latest.worktreeId?.split('/').at(-1),
              paneKey: latest.paneKey,
              notificationId: `headless:${key}:${settled.identity}`,
              agentType: latest.payload.agentType,
              agentState: settled.state,
              agentTurnOutcome: settled.verdict ?? undefined,
              agentPrompt: latest.payload.prompt,
              agentLastAssistantMessage: latest.payload.lastAssistantMessage,
              agentToolName: latest.payload.toolName,
              agentToolInput: latest.payload.toolInput
            })
          }, AGENT_NOTIFICATION_QUIET_MS)
        }
        previous.pending = pending
      }
      paneStates.delete(key)
      paneStates.set(key, previous)
      while (paneStates.size > 1024) {
        const oldest = paneStates.keys().next().value
        if (oldest === undefined) {
          break
        }
        const evicted = paneStates.get(oldest)
        if (evicted) {
          clearPending(evicted)
        }
        paneStates.delete(oldest)
      }
    },
    dispose() {
      paneStates.forEach(clearPending)
      paneStates.clear()
    },
    sideEffects(batch: TerminalSideEffectBatch) {
      if (deps.enabled() && !batch.replay && batch.facts.some((fact) => fact.kind === 'bell')) {
        send({
          source: 'terminal-bell',
          worktreeId: batch.worktreeId,
          worktreeLabel: batch.worktreeId?.split('/').at(-1),
          notificationId: `headless:bell:${batch.ptyId}:${batch.seq}`
        })
      }
    }
  }
}
