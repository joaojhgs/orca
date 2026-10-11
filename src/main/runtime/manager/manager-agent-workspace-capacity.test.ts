import { describe, expect, it } from 'vitest'
import type { EnrichedAgentHookEventPayload } from '../../agent-hooks/server/server-types'
import { assertManagerAgentWorkspaceCapacity } from './manager-agent-workspace-capacity'

const row = (
  patch: Partial<EnrichedAgentHookEventPayload> = {}
): EnrichedAgentHookEventPayload => ({
  paneKey: 'user-pane',
  connectionId: 'desktop',
  worktreeId: 'repo::/workspace',
  receivedAt: 10,
  stateStartedAt: 1,
  payload: { state: 'working', prompt: 'Private task' },
  ...patch
})

describe('manager dispatch beside existing agent sessions', () => {
  it.each(['working', 'waiting', 'blocked'] as const)(
    'preserves a %s user session without adopting, guiding or stopping it',
    (state) => {
      const event = row({ payload: { state, prompt: 'Private task' } })
      const before = JSON.stringify(event)
      expect(() =>
        assertManagerAgentWorkspaceCapacity([event], 'ssh:desktop', 'repo::/workspace')
      ).toThrow('current or unverifiable')
      expect(JSON.stringify(event)).toBe(before)
    }
  )

  it('does not mistake a settled parent with working child agents for an available workspace', () => {
    const event = row({
      payload: {
        state: 'working',
        prompt: '',
        mainAgent: { state: 'done', stateStartedAt: 10, outcome: 'success' }
      }
    })
    expect(() =>
      assertManagerAgentWorkspaceCapacity([event], 'ssh:desktop', 'repo::/workspace')
    ).toThrow('current or unverifiable')
  })

  it.each([
    { restoredUnconfirmed: true },
    { retainedForLiveness: true },
    { isReplay: true }
  ] satisfies Partial<EnrichedAgentHookEventPayload>[])(
    'does not treat unconfirmed evidence as free editing capacity: %j',
    (patch) => {
      expect(() =>
        assertManagerAgentWorkspaceCapacity(
          [row({ ...patch, payload: { state: 'done', prompt: '' } })],
          'ssh:desktop',
          'repo::/workspace'
        )
      ).toThrow('current or unverifiable')
    }
  )

  it('ignores historical provider-session identities rather than claiming they are running', () => {
    expect(() =>
      assertManagerAgentWorkspaceCapacity(
        [row({ providerSessionOnly: true })],
        'ssh:desktop',
        'repo::/workspace'
      )
    ).not.toThrow()
  })

  it('permits a positively settled turn without terminating its terminal', () => {
    expect(() =>
      assertManagerAgentWorkspaceCapacity(
        [row({ payload: { state: 'done', prompt: '' } })],
        'ssh:desktop',
        'repo::/workspace',
        'connected'
      )
    ).not.toThrow()
  })

  it('does not declare an old done row available while execution contact is lost', () => {
    const event = row({ payload: { state: 'done', prompt: '' } })
    expect(() =>
      assertManagerAgentWorkspaceCapacity(
        [event],
        'ssh:desktop',
        'repo::/workspace',
        'unverifiable'
      )
    ).toThrow('current or unverifiable')
  })

  it('keeps host, workspace and folder scope boundaries intact', () => {
    expect(() =>
      assertManagerAgentWorkspaceCapacity([row()], 'ssh:notebook', 'repo::/workspace')
    ).not.toThrow()
    expect(() =>
      assertManagerAgentWorkspaceCapacity([row()], 'ssh:desktop', 'repo::/independent')
    ).not.toThrow()
    expect(() =>
      assertManagerAgentWorkspaceCapacity(
        [row({ worktreeId: 'folder:one' })],
        'ssh:desktop',
        'folder:one'
      )
    ).toThrow('current or unverifiable')
    expect(() =>
      assertManagerAgentWorkspaceCapacity(
        [row({ worktreeId: 'folder:one' })],
        'ssh:desktop',
        'folder:two'
      )
    ).not.toThrow()
  })
})
