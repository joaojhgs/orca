import { describe, expect, it } from 'vitest'
import { FakeLogicalClient, FakeSession } from '../transport/mobile-endpoint-supervisor-test-fakes'
import {
  mobileManagerWorkspaceChoices,
  readMobileManagerWorkspaces
} from './mobile-manager-workspace-choices'

const row = (worktreeId: string, hostId = 'local') => ({
  worktreeId,
  hostId,
  displayName: worktreeId,
  isArchived: false
})
describe('native manager exact workspace admission', () => {
  it('keeps SSH and folder workspaces, without selecting another managed controller', () => {
    expect(
      mobileManagerWorkspaceChoices({
        truncated: false,
        worktrees: [
          row('worktree:repo::main', 'ssh:worker'),
          row('folder:project', 'ssh:desktop'),
          row('foreign', 'runtime:another-controller'),
          { ...row('archived'), isArchived: true },
          { ...row('removing'), removing: true }
        ]
      })
    ).toEqual([
      { id: 'folder:project', label: 'folder:project · ssh:desktop' },
      { id: 'repo::main', label: 'worktree:repo::main · ssh:worker' }
    ])
  })

  it('excludes ambiguous canonical IDs across hosts', () => {
    expect(
      mobileManagerWorkspaceChoices({
        truncated: false,
        worktrees: [
          row('repo::main', 'ssh:a'),
          row('worktree:repo::main', 'ssh:b'),
          row('folder:unique')
        ]
      })
    ).toEqual([{ id: 'folder:unique', label: 'folder:unique · local' }])
  })

  it('refuses incomplete or malformed catalogs rather than offering guessed workspaces', () => {
    expect(() =>
      mobileManagerWorkspaceChoices({ truncated: true, worktrees: [row('partial')] })
    ).toThrow('truncated')
    expect(() => mobileManagerWorkspaceChoices({ worktrees: [row('missing-envelope')] })).toThrow()
    expect(() =>
      mobileManagerWorkspaceChoices({ truncated: false, worktrees: [{ id: 'wrong-wire-shape' }] })
    ).toThrow()
  })

  it('requests the existing full cross-host catalog', async () => {
    const client = new FakeSession('connected')
    client.sendRequest.mockResolvedValue({
      id: 'reply',
      ok: true,
      result: { truncated: false, worktrees: [row('folder:project')] }
    })
    expect(await readMobileManagerWorkspaces(client)).toHaveLength(1)
    expect(client.sendRequest).toHaveBeenCalledWith('worktree.ps', { limit: 10_000 })
  })

  it('rejects catalogs arriving after a logical authority migration', async () => {
    const client = new FakeLogicalClient('connected', 'lan')
    client.sendRequest.mockImplementationOnce(async () => {
      await client.migrateTo(new FakeSession('connected'), 'relay')
      return { id: 'reply', ok: true, result: { truncated: false, worktrees: [row('stale')] } }
    })
    await expect(readMobileManagerWorkspaces(client)).rejects.toThrow(
      'Controller connection changed'
    )
  })

  it('fails closed while disconnected or when the host refuses the catalog', async () => {
    const client = new FakeSession('disconnected')
    await expect(readMobileManagerWorkspaces(client)).rejects.toThrow('Connect')
    expect(client.sendRequest).not.toHaveBeenCalled()
    client.publishState('connected')
    client.sendRequest.mockResolvedValue({
      id: 'reply',
      ok: false,
      error: { code: 'unavailable', message: 'Host offline' }
    })
    await expect(readMobileManagerWorkspaces(client)).rejects.toThrow('Could not read')
  })
})
