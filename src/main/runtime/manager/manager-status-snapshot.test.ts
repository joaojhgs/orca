import { describe, expect, it } from 'vitest'
import type { EnrichedAgentHookEventPayload } from '../../agent-hooks/server/server-types'
import type { Repo } from '../../../shared/repo-types'
import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import { managerHookScope } from './manager-hook-scope'
import { managerStatusSnapshot } from './manager-status-snapshot'
import { managerMayObserve } from '../../../shared/manager-event-contract'

const repo: Repo = {
  id: 'repo',
  path: '/repo',
  displayName: 'Test',
  badgeColor: 'blue',
  addedAt: 1,
  connectionId: 'worker'
}
const event: EnrichedAgentHookEventPayload = {
  paneKey: 'pane',
  connectionId: 'worker',
  worktreeId: 'repo::/repo',
  stateStartedAt: 1,
  receivedAt: 2,
  launchToken: 'private-launch-token',
  payload: { state: 'waiting', prompt: 'Question' }
}
const scope = managerHookScope(event, [repo], [])
if (!scope?.projectId) {
  throw new Error('fixture has no project')
}
const grant = { executionHostIds: ['ssh:worker'], projectIds: [scope.projectId], runIds: [] }
const input = {
  grant,
  repos: [repo],
  setups: [],
  statuses: [event],
  sshConnected: () => true,
  offset: 0,
  limit: 100
}
const folder: FolderWorkspace = {
  id: 'folder-one',
  projectGroupId: 'group',
  name: 'Folder',
  folderPath: '/folder',
  connectionId: 'worker',
  linkedTask: null,
  comment: '',
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 1,
  createdAt: 1,
  updatedAt: 1
}
describe('manager scoped status reconciliation', () => {
  it('reports current evidence without claiming a missed-event replay or exposing launch secrets', () => {
    const snapshot = managerStatusSnapshot(input)
    expect(snapshot.continuity).toBe('snapshot-not-replay')
    expect(snapshot.sessions[0]).toMatchObject({
      state: 'waiting',
      statusEvidence: 'current',
      executionContact: 'connected'
    })
    expect(JSON.stringify(snapshot)).not.toContain('private-launch-token')
  })
  it('disconnection or unconfirmed restore never means process exit', () => {
    expect(
      managerStatusSnapshot({ ...input, sshConnected: () => false }).sessions[0]
    ).toMatchObject({
      state: 'waiting',
      statusEvidence: 'unconfirmed',
      executionContact: 'unverifiable'
    })
    expect(
      managerStatusSnapshot({ ...input, statuses: [{ ...event, restoredUnconfirmed: true }] })
        .sessions[0]
    ).toMatchObject({ statusEvidence: 'unconfirmed' })
  })
  it('filters hosts, projects, unknown ownership and explicitly scoped Runs before exposing prose', () => {
    expect(
      managerStatusSnapshot({ ...input, grant: { ...grant, executionHostIds: ['ssh:other'] } })
        .sessions
    ).toEqual([])
    expect(
      managerStatusSnapshot({ ...input, grant: { ...grant, projectIds: [] } }).sessions
    ).toEqual([])
    expect(
      managerStatusSnapshot({
        ...input,
        dispatchForEvent: () => ({ id: 'dispatch', run_id: 'other' })
      }).sessions
    ).toEqual([])
    expect(managerHookScope({ ...event, worktreeId: 'unknown::/host' }, [repo], [])).toBeNull()
    expect(managerHookScope(event, [repo, repo], [])).toBeNull()
  })
  it('keeps folder workspaces scoped to their real group and execution host', () => {
    const folderEvent = { ...event, worktreeId: 'folder:folder-one' }
    const folderScope = managerHookScope(folderEvent, [], [], undefined, [folder])
    expect(folderScope).toMatchObject({
      projectGroupId: 'group',
      workspaceId: 'folder:folder-one',
      executionHostId: 'ssh:worker'
    })
    expect(
      managerHookScope({ ...folderEvent, connectionId: 'other' }, [], [], undefined, [folder])
    ).toBeNull()
    if (!folderScope) {
      throw new Error('folder not resolved')
    }
    expect(managerMayObserve(grant, folderScope)).toBe(false)
    expect(managerMayObserve({ ...grant, projectGroupIds: ['group'] }, folderScope)).toBe(true)
  })
  it('bounds pages without silently dropping later statuses', () => {
    const statuses = [event, { ...event, paneKey: 'other' }]
    const first = managerStatusSnapshot({ ...input, statuses, limit: 1 })
    expect(first).toMatchObject({ hasMore: true, nextOffset: 1 })
    expect(first.sessions).toHaveLength(1)
    const next = managerStatusSnapshot({ ...input, statuses, limit: 1, offset: 1 })
    expect(next).toMatchObject({ hasMore: false, nextOffset: null })
    expect(next.sessions[0].scope.sessionId).toBe('other')
  })
})
