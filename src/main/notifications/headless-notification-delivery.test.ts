import { expect, it, vi } from 'vitest'
import { createHeadlessNotificationDelivery } from './headless-notification-delivery'
import type { EnrichedAgentHookEventPayload } from '../agent-hooks/server/server-types'
import type { NotificationSettings } from '../../shared/notification-settings-types'

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
  let now = 10000
  const delivery = createHeadlessNotificationDelivery({
    enabled: () => headless,
    settings: () => settings,
    dispatch,
    now: () => now
  })
  const event = (
    state: 'working' | 'done' | 'waiting' | 'blocked',
    overrides: Partial<EnrichedAgentHookEventPayload> = {}
  ): EnrichedAgentHookEventPayload => ({
    paneKey: 'pane',
    connectionId: 'personal',
    worktreeId: '/projects/example',
    receivedAt: now,
    stateStartedAt: now,
    payload: { state, prompt: 'fixture', agentType: 'codex' },
    ...overrides
  })
  return {
    delivery,
    dispatch,
    event,
    settings,
    desktop: () => {
      headless = false
    },
    advance: () => {
      now += 60000
    }
  }
}
it('delivers a live SSH completion without a renderer, with sequence-ready mobile dispatch', () => {
  const f = fixture()
  f.delivery.status(f.event('working'))
  f.advance()
  f.delivery.status(f.event('done'))
  f.delivery.status(f.event('done'))
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
  f.delivery.status(f.event('working'))
  f.delivery.status(f.event('done', { isReplay: true }))
  f.delivery.status(f.event('waiting', { restoredUnconfirmed: true }))
  f.delivery.status(
    f.event('done', { payload: { state: 'done', prompt: '', sessionBoundary: true } })
  )
  f.delivery.status(f.event('working'))
  f.delivery.status(f.event('done', { payload: { state: 'done', prompt: '', interrupted: true } }))
  expect(f.dispatch).not.toHaveBeenCalled()
})
it('reports needs input, honors notification preferences, and yields to the desktop renderer', () => {
  const f = fixture()
  f.delivery.status(f.event('waiting'))
  expect(f.dispatch).toHaveBeenCalledTimes(1)
  f.advance()
  f.settings.enabled = false
  f.delivery.status(f.event('blocked'))
  f.settings.enabled = true
  f.desktop()
  f.delivery.status(f.event('working'))
  f.delivery.status(f.event('done'))
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
