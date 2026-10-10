import { expect, it } from 'vitest'
import { notificationPolicyTargets } from './notification-policy-targets'
import type { Repo } from '../../shared/repo-types'
import type { EnrichedAgentHookEventPayload } from '../agent-hooks/server/server-types'

const repo: Repo = {
  id: 'repo',
  path: '/repo',
  displayName: 'Project',
  badgeColor: 'blue',
  addedAt: 1,
  connectionId: 'worker'
}
it('uses canonical host-qualified workspaces and opaque session generations without exposing hook secrets', () => {
  const event: EnrichedAgentHookEventPayload = {
    paneKey: 'pane',
    connectionId: 'worker',
    worktreeId: 'repo::/repo',
    stateStartedAt: 1,
    receivedAt: 2,
    launchToken: 'private-launch-token',
    payload: { state: 'waiting', prompt: 'private question body' }
  }
  const runtime = {
    listRepos: () => [repo, { ...repo, connectionId: 'other' }],
    listProjectHostSetups: () => [],
    listProjectGroups: () => [],
    listFolderWorkspaces: () => []
  }
  const rows = notificationPolicyTargets(runtime, [event, event])
  expect(
    rows
      .filter((row) => row.selector.level === 'workspace')
      .map((row) => row.scope.executionHostId)
      .sort()
  ).toEqual(['ssh:other', 'ssh:worker'])
  expect(rows.filter((row) => row.selector.level === 'session')).toHaveLength(1)
  expect(rows.find((row) => row.selector.level === 'session')?.selector).toMatchObject({
    id: 'pane',
    generation: expect.stringMatching(/^[a-f0-9]{64}$/)
  })
  expect(JSON.stringify(rows)).not.toContain('private-launch-token')
  expect(JSON.stringify(rows)).not.toContain('private question body')
})
