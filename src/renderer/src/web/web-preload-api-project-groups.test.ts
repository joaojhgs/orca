import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import {
  installBrowserGlobals,
  writeStoredRuntimeEnvironment
} from './web-preload-api-test-harness'

const group: ProjectGroup = {
  id: 'group-1',
  name: 'Games',
  parentPath: null,
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
}
const repo = {
  id: 'repo-1',
  path: '/srv/game',
  displayName: 'Game',
  badgeColor: '#000',
  addedAt: 1,
  projectGroupId: group.id
}

async function setup(resultFor: (method: string, params: unknown) => unknown) {
  const call = vi.fn(
    async (method: string, params?: unknown): Promise<RuntimeRpcResponse<unknown>> => ({
      id: method,
      ok: true,
      result: await resultFor(method, params),
      _meta: { runtimeId: 'runtime-1' }
    })
  )
  vi.doMock('./web-runtime-client', () => ({
    WebRuntimeClient: class {
      call = call
      close(): void {}
    }
  }))
  const globals = installBrowserGlobals('Linux')
  writeStoredRuntimeEnvironment(globals.storage, 'web-server-a')
  const { installWebPreloadApi } = await import('./web-preload-api')
  installWebPreloadApi()
  return { ...globals, call, api: globals.window.api }
}

describe('paired browser project groups', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('./web-runtime-client')
  })

  it('uses concrete RPC-backed methods for listing, creation and updates', async () => {
    const { api, call } = await setup((method) =>
      method === 'projectGroup.list' ? { groups: [group] } : { group }
    )
    const ownedGroup = { ...group, executionHostId: 'runtime:web-server-a' }
    await expect(api.projectGroups.list()).resolves.toEqual([ownedGroup])
    await expect(
      api.projectGroups.create({ name: 'Games', createdFrom: 'manual' })
    ).resolves.toEqual(ownedGroup)
    const updates = { name: 'Tools', isCollapsed: true, tabOrder: 2, color: 'blue' }
    await expect(api.projectGroups.update({ groupId: group.id, updates })).resolves.toEqual(
      ownedGroup
    )
    expect(call.mock.calls.map(([method, params]) => ({ method, params }))).toEqual([
      { method: 'projectGroup.list', params: undefined },
      { method: 'projectGroup.create', params: { name: 'Games', createdFrom: 'manual' } },
      { method: 'projectGroup.update', params: { groupId: group.id, updates } }
    ])
  })

  it('maps project selectors and preserves null update/move results', async () => {
    const { api, call } = await setup((method, params) => {
      if (method === 'projectGroup.moveProject') {
        return { repo: params && typeof params === 'object' && 'order' in params ? repo : null }
      }
      return method === 'projectGroup.delete' ? { deleted: true } : { group: null }
    })
    await expect(
      api.projectGroups.moveProject({ projectId: repo.id, groupId: group.id, order: 2 })
    ).resolves.toEqual({ ...repo, executionHostId: 'runtime:web-server-a' })
    await expect(
      api.projectGroups.moveProject({ projectId: repo.id, groupId: null })
    ).resolves.toBeNull()
    await expect(api.projectGroups.update({ groupId: group.id, updates: {} })).resolves.toBeNull()
    await expect(api.projectGroups.delete({ groupId: group.id })).resolves.toBe(true)
    expect(call.mock.calls.map(([method, params]) => ({ method, params }))).toEqual([
      {
        method: 'projectGroup.moveProject',
        params: { repo: repo.id, groupId: group.id, order: 2 }
      },
      { method: 'projectGroup.moveProject', params: { repo: repo.id, groupId: null } },
      { method: 'projectGroup.update', params: { groupId: group.id, updates: {} } },
      { method: 'projectGroup.delete', params: { groupId: group.id } }
    ])
  })

  it('returns real errors instead of an undefined fallback', async () => {
    const { api } = await setup(() => {
      throw new Error('Runtime unavailable')
    })
    await expect(api.projectGroups.create({ name: 'Games' })).rejects.toThrow('Runtime unavailable')
  })

  it('scans and imports on the paired runtime without leaking desktop-only fields', async () => {
    const scan = { selectedPath: '/srv', repos: [] }
    const imported = { group, projects: [], importedCount: 0, alreadyKnownCount: 0, failedCount: 0 }
    const { api, call } = await setup((method) =>
      method === 'projectGroup.scanNested' ? scan : imported
    )
    await expect(api.projectGroups.scanNested({ path: '/srv', scanId: 'scan-1' })).resolves.toEqual(
      scan
    )
    const args = {
      parentPath: '/srv',
      groupName: 'Games',
      projectPaths: [],
      mode: 'group' as const
    }
    await expect(api.projectGroups.importNested({ ...args, scanId: 'scan-1' })).resolves.toEqual({
      ...imported,
      group: { ...group, executionHostId: 'runtime:web-server-a' }
    })
    expect(call.mock.calls.map(([method, params]) => ({ method, params }))).toEqual([
      { method: 'projectGroup.scanNested', params: { path: '/srv' } },
      { method: 'projectGroup.importNested', params: args }
    ])
    await expect(
      api.projectGroups.scanNested({ path: '/srv', connectionId: 'ssh-1' })
    ).rejects.toThrow('Scanning nested projects on SSH hosts is unavailable')
    await expect(
      api.projectGroups.importNested({ ...args, connectionId: 'ssh-1' })
    ).rejects.toThrow('Importing nested projects on SSH hosts is unavailable')
    await expect(api.projectGroups.cancelNestedScan({ scanId: 'scan-1' })).rejects.toThrow(
      'Cancelling nested project scans is unavailable'
    )
    expect(call).toHaveBeenCalledTimes(2)
    expect(api.projectGroups.onNestedScanProgress(vi.fn())).toBeTypeOf('function')
  })

  it('preserves unsuccessful deletes and imports without a group', async () => {
    const imported = { projects: [], importedCount: 0, alreadyKnownCount: 0, failedCount: 0 }
    const { api } = await setup((method) =>
      method === 'projectGroup.delete' ? { deleted: false } : imported
    )
    await expect(api.projectGroups.delete({ groupId: 'missing' })).resolves.toBe(false)
    await expect(
      api.projectGroups.importNested({
        parentPath: '/srv',
        groupName: '',
        projectPaths: [],
        mode: 'separate'
      })
    ).resolves.toEqual(imported)
  })

  it('keeps the original paired owner when pairing changes during creation', async () => {
    const pending = Promise.withResolvers<{ group: ProjectGroup }>()
    const { api, storage } = await setup(() => pending.promise)
    const creation = api.projectGroups.create({ name: 'Games' })
    writeStoredRuntimeEnvironment(storage, 'web-server-b')
    const { webRuntimeState } = await import('./preload-api/web-runtime-session')
    const { readStoredWebRuntimeEnvironment } = await import('./web-runtime-environment')
    webRuntimeState.activeEnvironment = readStoredWebRuntimeEnvironment()
    pending.resolve({ group })
    await expect(creation).resolves.toMatchObject({ executionHostId: 'runtime:web-server-a' })
  })

  it('allows the real store to create a group when browser settings still select local', async () => {
    const { api } = await setup(() => ({ group }))
    const { createTestStore } = await import('../store/slices/store-test-helpers')
    const { getDefaultSettings } = await import('../../../shared/constants')
    const store = createTestStore()
    store.setState({
      settings: { ...getDefaultSettings('/test'), activeRuntimeEnvironmentId: null }
    })
    expect(api.projectGroups.create).toBeTypeOf('function')
    await expect(store.getState().createProjectGroup('Games')).resolves.toEqual({
      ...group,
      executionHostId: 'runtime:web-server-a'
    })
    expect(store.getState().projectGroups).toEqual([
      { ...group, executionHostId: 'runtime:web-server-a' }
    ])
  })
})
