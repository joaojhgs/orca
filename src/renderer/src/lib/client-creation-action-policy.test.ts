import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/workspace/identity/floating-workspace-id'
import type { RuntimeStatus } from '../../../shared/remote-runtime/session-graph/runtime-session-contracts'
import {
  toRuntimeExecutionHostId,
  toSshExecutionHostId
} from '../../../shared/execution-host/execution-host'
import { folderWorkspaceKey } from '../../../shared/workspace/identity/workspace-scope'
import { getDefaultSettings } from '../../../shared/orca-profiles/constants'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { TEST_REPO } from '@/store/repos/repo.test-fixture'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import {
  assertClientCreationActionAvailable,
  assertManagedBrowserMaterializationAllowed,
  getClientCreationActionPolicy,
  resolveClientCreationActionPolicy
} from './workspace/creation/surface-policy/client-creation-action-policy'

function seedRuntimeStatus(environmentId: string, status: RuntimeStatus): void {
  useAppStore.setState((state) => ({
    runtimeStatusByEnvironmentId: new Map(state.runtimeStatusByEnvironmentId).set(environmentId, {
      status,
      checkedAt: 1
    })
  }))
}

function creationState(overrides?: Partial<AppState>): AppState {
  return { ...useAppStore.getInitialState(), ...overrides }
}

function settingsWithFocusedRuntime(activeRuntimeEnvironmentId: string) {
  return { ...getDefaultSettings('/tmp/orca-workspaces'), activeRuntimeEnvironmentId }
}

function runtimeStatus(capabilities?: string[]): RuntimeStatus {
  return {
    runtimeId: 'runtime-1',
    rendererGraphEpoch: 1,
    graphStatus: 'ready',
    authoritativeWindowId: null,
    liveTabCount: 0,
    liveLeafCount: 0,
    hostPlatform: 'darwin',
    capabilities
  }
}

describe('resolveClientCreationActionPolicy', () => {
  it('preserves Electron creation behavior without negotiated runtime signals', () => {
    expect(resolveClientCreationActionPolicy({ surface: 'electron', runtimeStatus: null })).toEqual(
      {
        'managed-browser': { state: 'enabled', provider: 'local-client' },
        'mobile-emulator': { state: 'enabled', provider: 'local-client' }
      }
    )
  })

  it('selects the provider that the browser action path can actually consume', () => {
    const desktopHost = runtimeStatus(['browser.screencast.v1'])
    const npmHostWithoutDisplay = { ...runtimeStatus(), hostPlatform: 'linux' as const }
    const npmHostWithDisplay = {
      ...runtimeStatus(['browser.screencast.v1', 'browser.headless.v1']),
      hostPlatform: 'linux' as const
    }

    expect(
      resolveClientCreationActionPolicy({ surface: 'electron', runtimeStatus: desktopHost })
    ).toEqual({
      'managed-browser': { state: 'enabled', provider: 'paired-runtime' },
      'mobile-emulator': { state: 'enabled', provider: 'local-client' }
    })
    expect(
      resolveClientCreationActionPolicy({
        surface: 'electron',
        runtimeStatus: npmHostWithoutDisplay
      })
    ).toEqual({
      'managed-browser': { state: 'enabled', provider: 'local-client' },
      'mobile-emulator': { state: 'enabled', provider: 'local-client' }
    })
    expect(
      resolveClientCreationActionPolicy({ surface: 'paired-web', runtimeStatus: desktopHost })
    ).toMatchObject({
      'managed-browser': { state: 'enabled', provider: 'paired-runtime' },
      'mobile-emulator': { state: 'hidden' }
    })
    expect(
      resolveClientCreationActionPolicy({
        surface: 'paired-web',
        runtimeStatus: npmHostWithoutDisplay
      })
    ).toMatchObject({
      'managed-browser': { state: 'hidden' },
      'mobile-emulator': { state: 'hidden' }
    })
    expect(
      resolveClientCreationActionPolicy({
        surface: 'paired-web',
        runtimeStatus: npmHostWithDisplay
      })['managed-browser']
    ).toEqual({ state: 'enabled', provider: 'paired-runtime' })
  })

  it('enables paired-web browser creation only with negotiated streaming support', () => {
    expect(
      resolveClientCreationActionPolicy({
        surface: 'paired-web',
        runtimeStatus: runtimeStatus(['browser.screencast.v1'])
      })['managed-browser']
    ).toEqual({ state: 'enabled', provider: 'paired-runtime' })

    expect(
      resolveClientCreationActionPolicy({
        surface: 'paired-web',
        runtimeStatus: runtimeStatus()
      })['managed-browser'].state
    ).toBe('hidden')
  })

  it('hides web-client floating browsers and mobile emulators as impossible surfaces', () => {
    const policy = resolveClientCreationActionPolicy({
      surface: 'paired-web',
      runtimeStatus: runtimeStatus(['browser.screencast.v1', 'mobile.tasks.v1']),
      floatingWorkspace: true
    })

    expect(policy['managed-browser'].state).toBe('hidden')
    expect(policy['mobile-emulator'].state).toBe('hidden')
  })

  it('restores device preview when the web preload provides frame streaming', () => {
    expect(
      resolveClientCreationActionPolicy({
        surface: 'paired-web',
        runtimeStatus: runtimeStatus(['mobile.tasks.v1']),
        emulatorFrameStreamingAvailable: true
      })['mobile-emulator']
    ).toEqual({ state: 'enabled', provider: 'paired-runtime' })
  })

  it('keeps floating device preview hidden even with a streaming preload', () => {
    expect(
      resolveClientCreationActionPolicy({
        surface: 'paired-web',
        runtimeStatus: null,
        floatingWorkspace: true,
        emulatorFrameStreamingAvailable: true
      })['mobile-emulator'].state
    ).toBe('hidden')
  })
})

describe('client creation action guards', () => {
  let priorStatuses: AppState['runtimeStatusByEnvironmentId']

  beforeEach(() => {
    priorStatuses = useAppStore.getState().runtimeStatusByEnvironmentId
    useAppStore.setState({ runtimeStatusByEnvironmentId: new Map() })
  })

  afterEach(() => {
    useAppStore.setState({ runtimeStatusByEnvironmentId: priorStatuses })
    vi.unstubAllGlobals()
  })

  it('allows the web device-preview action through its installed streaming bridge', () => {
    vi.stubGlobal('__ORCA_WEB_CLIENT__', true)
    vi.stubGlobal('window', {
      api: {
        emulator: { startFrameStream: vi.fn(), onFrameStreamFrame: vi.fn() }
      }
    })
    const state = creationState()

    expect(getClientCreationActionPolicy(state, null)['mobile-emulator']).toEqual({
      state: 'enabled',
      provider: 'paired-runtime'
    })
    expect(() => assertClientCreationActionAvailable(state, null, 'mobile-emulator')).not.toThrow()
  })

  it('fails closed for an older paired runtime and rejects local browser materialization', () => {
    vi.stubGlobal('__ORCA_WEB_CLIENT__', true)
    seedRuntimeStatus('runtime-1', runtimeStatus())
    const state = creationState({ settings: settingsWithFocusedRuntime('runtime-1') })

    expect(getClientCreationActionPolicy(state, null)['managed-browser'].state).toBe('hidden')
    expect(() => assertClientCreationActionAvailable(state, null, 'managed-browser')).toThrow()
    expect(() => assertManagedBrowserMaterializationAllowed(state, null)).toThrow()
  })

  it('permits host-confirmed remote browser materialization in paired web', () => {
    vi.stubGlobal('__ORCA_WEB_CLIENT__', true)
    seedRuntimeStatus('runtime-1', runtimeStatus(['browser.screencast.v1']))
    const state = creationState()
    expect(() => assertManagedBrowserMaterializationAllowed(state, 'runtime-1')).not.toThrow()
    expect(() => assertManagedBrowserMaterializationAllowed(state, 'unverified-runtime')).toThrow()
  })

  it('treats the floating workspace as local even with an active capable runtime', () => {
    vi.stubGlobal('__ORCA_WEB_CLIENT__', true)
    seedRuntimeStatus('runtime-1', runtimeStatus(['browser.screencast.v1']))
    const state = creationState({ settings: settingsWithFocusedRuntime('runtime-1') })

    expect(
      getClientCreationActionPolicy(state, FLOATING_TERMINAL_WORKTREE_ID)['managed-browser'].state
    ).toBe('hidden')
  })

  it('uses folder and SSH workspace ownership instead of the focused runtime', () => {
    vi.stubGlobal('__ORCA_WEB_CLIENT__', true)
    const capableStatus = runtimeStatus(['browser.screencast.v1'])
    seedRuntimeStatus('folder-owner', capableStatus)
    seedRuntimeStatus('focused-runtime', runtimeStatus())
    const folderHost = toRuntimeExecutionHostId('folder-owner')
    const state = creationState({
      settings: settingsWithFocusedRuntime('focused-runtime'),
      folderWorkspaces: [
        {
          id: 'remote-folder',
          projectGroupId: 'remote-group',
          executionHostId: folderHost,
          name: 'Remote folder',
          folderPath: '/srv/projects',
          linkedTask: null,
          comment: '',
          isArchived: false,
          isUnread: false,
          isPinned: false,
          sortOrder: 0,
          lastActivityAt: 0,
          createdAt: 0,
          updatedAt: 0
        }
      ],
      projectGroups: [
        {
          id: 'remote-group',
          executionHostId: folderHost,
          name: 'Remote group',
          parentPath: '/srv/projects',
          parentGroupId: null,
          createdFrom: 'folder-scan',
          tabOrder: 0,
          isCollapsed: false,
          color: null,
          createdAt: 0,
          updatedAt: 0
        }
      ],
      repos: [{ ...TEST_REPO, id: 'repo', connectionId: 'ssh-owner' }],
      worktreesByRepo: {
        repo: [
          makeWorktree({
            id: 'ssh-worktree',
            repoId: 'repo',
            hostId: toSshExecutionHostId('ssh-owner')
          })
        ]
      }
    })

    expect(
      getClientCreationActionPolicy(state, folderWorkspaceKey('remote-folder'))['managed-browser']
    ).toEqual({ state: 'enabled', provider: 'paired-runtime' })
    seedRuntimeStatus('focused-runtime', capableStatus)
    expect(getClientCreationActionPolicy(state, null)['managed-browser']).toEqual({
      state: 'enabled',
      provider: 'paired-runtime'
    })
    expect(getClientCreationActionPolicy(state, 'ssh-worktree')['managed-browser'].state).toBe(
      'hidden'
    )
  })
})
