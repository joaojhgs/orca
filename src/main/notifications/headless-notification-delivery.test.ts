import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHeadlessNotificationDelivery } from './headless-notification-delivery'
import type { EnrichedAgentHookEventPayload } from '../agent-hooks/server/server-types'
import type { NotificationSettings } from '../../shared/notification-settings-types'
import { AGENT_NOTIFICATION_QUIET_MS } from '../../shared/agent-notification-quiet-window'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(10000)
})
afterEach(() => vi.useRealTimers())

function fixture() {
  const settings: NotificationSettings = {
    enabled: true,
    agentTaskComplete: true,
    terminalBell: true,
    suppressWhenFocused: true,
    customSoundId: 'system',
    customSoundPath: null,
    customSoundVolume: 1
  }
  const dispatch = vi.fn()
  let headless = true
  const snapshot: EnrichedAgentHookEventPayload[] = []
  const delivery = createHeadlessNotificationDelivery({
    enabled: () => headless,
    settings: () => settings,
    dispatch,
    getStatusSnapshot: () => snapshot
  })
  const event = (
    state: 'working' | 'done' | 'waiting' | 'blocked',
    overrides: Partial<EnrichedAgentHookEventPayload> = {}
  ): EnrichedAgentHookEventPayload => ({
    paneKey: 'pane',
    connectionId: 'personal',
    worktreeId: '/projects/example',
    receivedAt: Date.now(),
    stateStartedAt: Date.now(),
    payload: { state, prompt: 'fixture', agentType: 'codex' },
    ...overrides
  })
  return {
    delivery,
    status: (row: EnrichedAgentHookEventPayload) => {
      const index = snapshot.findIndex(
        (entry) => entry.paneKey === row.paneKey && entry.connectionId === row.connectionId
      )
      if (index !== -1) {
        snapshot.splice(index, 1)
      }
      snapshot.push(row)
      delivery.status(row)
    },
    snapshot,
    dispatch,
    event,
    settings,
    desktop: () => {
      headless = false
    },
    advance: () => {
      vi.advanceTimersByTime(60000)
    },
    settle: () => vi.advanceTimersByTime(AGENT_NOTIFICATION_QUIET_MS)
  }
}
it('delivers a live SSH completion without a renderer, with sequence-ready mobile dispatch', () => {
  const f = fixture()
  f.status(f.event('working'))
  f.advance()
  f.status(f.event('done'))
  f.status(f.event('done'))
  expect(f.dispatch).not.toHaveBeenCalled()
  f.settle()
  expect(f.dispatch).toHaveBeenCalledTimes(1)
  expect(f.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      source: 'agent-task-complete',
      worktreeId: '/projects/example',
      agentState: 'done',
      desktopAway: true
    })
  )
})
it('ignores replay, hydrated state, session boundaries, and canceled turns', () => {
  const f = fixture()
  f.status(f.event('working'))
  f.status(f.event('done', { isReplay: true }))
  f.status(f.event('waiting', { restoredUnconfirmed: true }))
  f.status(f.event('done', { payload: { state: 'done', prompt: '', sessionBoundary: true } }))
  f.status(f.event('working'))
  f.status(f.event('done', { payload: { state: 'done', prompt: '', interrupted: true } }))
  f.settle()
  expect(f.dispatch).not.toHaveBeenCalled()
})
it('reports needs input, honors notification preferences, and yields to the desktop renderer', () => {
  const f = fixture()
  f.status(f.event('waiting'))
  f.settle()
  expect(f.dispatch).toHaveBeenCalledTimes(1)
  f.advance()
  f.settings.enabled = false
  f.status(f.event('blocked'))
  f.settle()
  f.settings.enabled = true
  f.desktop()
  f.status(f.event('working'))
  f.status(f.event('done'))
  f.settle()
  expect(f.dispatch).toHaveBeenCalledTimes(1)
})

it('cancels intermediate goal completions and automatically resolved approvals', () => {
  const f = fixture()
  for (const state of ['done', 'waiting', 'blocked'] as const) {
    f.status(f.event('working'))
    f.advance()
    f.status(f.event(state))
    vi.advanceTimersByTime(AGENT_NOTIFICATION_QUIET_MS - 1)
    f.status(f.event('working'))
    f.settle()
  }
  expect(f.dispatch).not.toHaveBeenCalled()
  f.status(f.event('done'))
  f.settle()
  expect(f.dispatch).toHaveBeenCalledTimes(1)
})

it('does not announce lead boundaries or child review results while the pane still has work', () => {
  const f = fixture()
  f.status(f.event('working'))
  for (const hookEventName of ['Stop', 'SubagentStop', 'PostToolUse']) {
    f.advance()
    f.status(
      f.event('working', {
        hookEventName,
        payload: {
          state: 'working',
          prompt: 'Keep working on Aurora',
          mainAgent: { state: 'done', stateStartedAt: Date.now() },
          subagents: [{ id: 'reviewer', state: 'working', startedAt: 10000 }],
          lastAssistantMessage: 'APPROVE / CLEAR'
        }
      })
    )
    f.settle()
  }
  expect(f.dispatch).not.toHaveBeenCalled()
})

it('does not announce a child completion while the lead is working', () => {
  const f = fixture()
  f.status(f.event('working'))
  f.status(
    f.event('done', {
      hookEventName: 'SubagentStop',
      payload: {
        state: 'done',
        prompt: 'Keep working',
        mainAgent: { state: 'working', stateStartedAt: 10000 },
        lastAssistantMessage: 'APPROVE'
      }
    })
  )
  f.settle()
  expect(f.dispatch).not.toHaveBeenCalled()
})

it('still notifies a persistent child question while the lead continues working', () => {
  const f = fixture()
  f.status(f.event('working'))
  const waiting = f.event('waiting', {
    payload: {
      state: 'waiting',
      prompt: 'Build Aurora',
      toolName: 'request_user_input',
      mainAgent: { state: 'working', stateStartedAt: 10000 },
      subagents: [{ id: 'child', state: 'waiting', startedAt: 10000 }]
    }
  })
  f.status(waiting)
  f.settle()
  f.advance()
  f.status({ ...waiting, receivedAt: Date.now() })
  f.settle()
  expect(f.dispatch).toHaveBeenCalledTimes(1)
  expect(f.dispatch).toHaveBeenCalledWith(expect.objectContaining({ agentState: 'waiting' }))
})

it('checks current authoritative evidence when a pane is removed without a new hook', () => {
  const f = fixture()
  f.status(f.event('working'))
  f.status(f.event('done'))
  f.snapshot.splice(0)
  f.settle()
  expect(f.dispatch).not.toHaveBeenCalled()
})

it('cancels timers on shutdown and rechecks headless ownership and preferences before sending', () => {
  for (const change of ['dispose', 'desktop', 'settings'] as const) {
    const f = fixture()
    f.status(f.event('working'))
    f.status(f.event('done'))
    if (change === 'dispose') {
      f.delivery.dispose()
    }
    if (change === 'desktop') {
      f.desktop()
    }
    if (change === 'settings') {
      f.settings.enabled = false
    }
    f.settle()
    expect(f.dispatch).not.toHaveBeenCalled()
  }
})

it('keeps pending events scoped to their SSH host and cancels an evicted pane timer', () => {
  const f = fixture()
  for (const connectionId of ['desktop', 'worker']) {
    f.status(f.event('working', { connectionId, worktreeId: connectionId }))
    f.status(f.event('done', { connectionId, worktreeId: connectionId }))
  }
  f.status(f.event('working', { connectionId: 'desktop', worktreeId: 'desktop' }))
  f.settle()
  expect(f.dispatch).toHaveBeenCalledTimes(1)
  expect(f.dispatch).toHaveBeenCalledWith(expect.objectContaining({ worktreeId: 'worker' }))
  f.advance()
  f.status(f.event('waiting', { paneKey: 'evicted' }))
  for (let index = 0; index < 1024; index++) {
    f.status(f.event('working', { paneKey: `pane-${index}` }))
  }
  f.settle()
  expect(f.dispatch).toHaveBeenCalledTimes(1)
})

it('does not carry completion eligibility across a new agent launch', () => {
  const f = fixture()
  f.status(f.event('working', { launchToken: 'first-launch' }))
  f.status(f.event('done', { launchToken: 'first-launch' }))
  f.status(f.event('done', { launchToken: 'second-launch' }))
  f.settle()
  expect(f.dispatch).not.toHaveBeenCalled()
  f.status(f.event('working', { launchToken: 'second-launch' }))
  f.status(f.event('done', { launchToken: 'second-launch' }))
  f.settle()
  expect(f.dispatch).toHaveBeenCalledTimes(1)
})

it('keeps a repeated pending completion on its original deadline and uses the latest body', () => {
  const f = fixture()
  f.status(f.event('working'))
  const done = f.event('done')
  f.status(done)
  vi.advanceTimersByTime(1000)
  f.status({
    ...done,
    receivedAt: Date.now(),
    payload: { ...done.payload, lastAssistantMessage: 'Final result' }
  })
  vi.advanceTimersByTime(500)
  expect(f.dispatch).toHaveBeenCalledTimes(1)
  expect(f.dispatch).toHaveBeenCalledWith(expect.objectContaining({ body: 'Final result' }))
  f.advance()
  f.status(done)
  f.settle()
  expect(f.dispatch).toHaveBeenCalledTimes(1)
})

it('allows a genuine finish once outstanding child work settles', () => {
  const f = fixture()
  f.status(f.event('working'))
  const mainAgent = { state: 'done' as const, stateStartedAt: Date.now() }
  f.status(
    f.event('working', {
      payload: { state: 'working', prompt: 'Build game', mainAgent }
    })
  )
  f.settle()
  expect(f.dispatch).not.toHaveBeenCalled()
  f.status(f.event('done', { payload: { state: 'done', prompt: 'Build game', mainAgent } }))
  f.settle()
  expect(f.dispatch).toHaveBeenCalledTimes(1)
})
it('delivers live bells but never replayed bells or silent-title idle hints', () => {
  const f = fixture()
  f.delivery.sideEffects({
    ptyId: 'pty',
    seq: 1,
    worktreeId: 'wt',
    replay: true,
    facts: [{ kind: 'bell' }]
  })
  f.delivery.sideEffects({
    ptyId: 'pty',
    seq: 2,
    worktreeId: 'wt',
    facts: [{ kind: 'agent-idle', title: 'done', staleWorkingTitleClear: true }]
  })
  f.delivery.sideEffects({ ptyId: 'pty', seq: 3, worktreeId: 'wt', facts: [{ kind: 'bell' }] })
  expect(f.dispatch).toHaveBeenCalledTimes(1)
  expect(f.dispatch).toHaveBeenCalledWith(expect.objectContaining({ source: 'terminal-bell' }))
})
