import { describe, expect, it } from 'vitest'
import type { EnrichedAgentHookEventPayload } from '../../agent-hooks/server/server-types'
import type { ManagerEventScope } from '../../../shared/manager-event-contract'
import { managerHookEvent } from './manager-hook-event'

const scope: ManagerEventScope = { executionHostId: 'ssh:worker', projectId: 'p', actor: 'worker' }
const event = (
  patch: Partial<EnrichedAgentHookEventPayload> = {}
): EnrichedAgentHookEventPayload => ({
  paneKey: 'pane',
  connectionId: 'worker',
  worktreeId: 'repo::/workspace',
  launchToken: 'secret-launch-token',
  stateStartedAt: 1000,
  receivedAt: 1100,
  payload: { state: 'waiting', prompt: 'Question', agentType: 'codex' },
  ...patch
})
describe('canonical hook manager projection', () => {
  it('bounds untrusted prose, hashes launch secrets and preserves execution ownership', () => {
    const input = managerHookEvent(
      event({
        payload: { state: 'waiting', prompt: 'x'.repeat(9000) }
      }),
      scope
    )
    expect(input?.summary).toHaveLength(4096)
    expect(input?.scope.executionHostId).toBe('ssh:worker')
    expect(JSON.stringify(input)).not.toContain('secret-launch-token')
  })
  it('deduplicates an unchanged wait even if a reconnect restamps receipt time', () => {
    expect(managerHookEvent(event(), scope)?.eventId).toBe(
      managerHookEvent(event({ receivedAt: 9999999 }), scope)?.eventId
    )
  })
  it.each([
    { isReplay: true },
    { restoredUnconfirmed: true },
    { providerSessionOnly: true },
    { retainedForLiveness: true },
    { toolAgentId: 'internal-subagent' },
    { teammateName: 'child' }
  ] satisfies Partial<EnrichedAgentHookEventPayload>[])(
    'does not wake from replay, stale evidence or internal child lifecycle %s',
    (patch) => {
      expect(managerHookEvent(event(patch), scope)).toBeNull()
    }
  )
  it('never wakes itself from the manager conversation lifecycle', () => {
    expect(managerHookEvent(event(), { ...scope, actor: 'manager' })).toBeNull()
  })
  it('records a turn boundary as an inspection cue, never successful task settlement', () => {
    const input = managerHookEvent(event({ payload: { state: 'done', prompt: 'done' } }), scope)
    expect(input?.kind).toBe('turn-complete')
    expect(input?.outcome).toBeUndefined()
  })
  it('preserves a reported failure while child agents keep working', () => {
    const input = managerHookEvent(
      event({
        payload: {
          state: 'working',
          prompt: '',
          mainAgent: { state: 'done', stateStartedAt: 1200, outcome: 'failure' }
        }
      }),
      scope
    )
    expect(input?.kind).toBe('failure')
    expect(input?.occurredAt).toBe(1200)
  })
})
