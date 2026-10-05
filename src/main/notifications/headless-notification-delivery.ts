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

// Consumes accepted host evidence, not renderer presence or output silence. It
// never synthesizes a completion from a disconnect, stale title, or process exit.
export function createHeadlessNotificationDelivery(deps: {
  enabled(): boolean
  settings(): NotificationSettings
  dispatch(event: MobileNotificationDispatchEvent): void
  now?: () => number
}) {
  const paneStates = new Map<string, { working: boolean; announced: string | null }>()
  const cooldown = new Map<string, number>()
  const now = deps.now ?? Date.now
  const send = (request: NotificationDispatchRequest) => {
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
      if (
        !deps.enabled() ||
        event.isReplay ||
        event.restoredUnconfirmed ||
        event.providerSessionOnly ||
        event.retainedForLiveness
      ) {
        return
      }
      const payload = event.payload
      const key = `${event.connectionId ?? 'local'}:${event.paneKey}`
      const previous = paneStates.get(key) ?? { working: false, announced: null }
      const state = payload.mainAgent?.state ?? payload.state
      if (state === 'working' && payload.turnCompletedAt === undefined) {
        previous.working = true
      }
      const verdict = agentMainAgentVerdict(payload)
      const needsInput = state === 'waiting' || state === 'blocked'
      const completion =
        state === 'done' &&
        previous.working &&
        !payload.sessionBoundary &&
        !['cancellation', 'superseded', 'unconfirmed', 'interruption'].includes(verdict ?? '')
      const identity = `${state}:${payload.mainAgent?.stateStartedAt ?? payload.turnCompletedAt ?? event.stateStartedAt}`
      if ((completion || needsInput) && previous.announced !== identity) {
        previous.announced = identity
        send({
          source: 'agent-task-complete',
          worktreeId: event.worktreeId,
          worktreeLabel: event.worktreeId?.split('/').at(-1),
          paneKey: event.paneKey,
          notificationId: `headless:${key}:${identity}`,
          agentType: payload.agentType,
          agentState: state,
          agentTurnOutcome: verdict ?? undefined,
          agentPrompt: payload.prompt,
          agentLastAssistantMessage: payload.lastAssistantMessage,
          agentToolName: payload.toolName,
          agentToolInput: payload.toolInput
        })
      }
      if (state === 'done') {
        previous.working = false
      }
      paneStates.delete(key)
      paneStates.set(key, previous)
      while (paneStates.size > 1024) {
        const oldest = paneStates.keys().next().value
        if (oldest === undefined) {
          break
        }
        paneStates.delete(oldest)
      }
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
