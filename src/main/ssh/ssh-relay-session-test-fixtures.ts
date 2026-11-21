import { getDefaultWorkspaceSession } from '../../shared/orca-profiles/constants'
import type { SshRelaySessionStore } from './ssh-relay-session'
import type { Store } from '../persistence/loading-store/store'
import { resolveSshReattachPtyBinding } from '../persistence/loading-store/terminal-bindings/ssh-reattach-pty-binding'
import { vi, type Mock } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { SshConnection } from './connection/ssh-connection'
import type { PersistPtyBindingArgs } from '../persistence/loading-store/terminal-bindings/pty-binding-persistence'
import type { SshPortForwardManager } from './port-forwarding/ssh-port-forward'
import { deployAndLaunchRelay } from './ssh-relay-deploy'
import type {
  OpenSshPtyConsumerSessionOptions,
  SshPtyConsumerAdmission
} from './ssh-pty-consumer-session'

export function createMockConsumerAdmission(
  options: OpenSshPtyConsumerSessionOptions
): SshPtyConsumerAdmission {
  return {
    state: {
      mode: 'negotiated',
      clientInstanceId: options.clientInstanceId,
      clientGeneration: 1,
      ownerGeneration: 1,
      ownerLease: 'test-owner-lease',
      ...(options.outputFlowControl
        ? {
            outputFlowControl: {
              version: 1 as const,
              windowSu: options.outputFlowControl.requestedWindowSu
            }
          }
        : {})
    },
    resumed: options.resume !== undefined
  }
}

type SshRelaySessionTestStore = SshRelaySessionStore & Pick<Store, 'markSshRemotePtyLeases'>

type SshRelaySessionTestDeps = {
  mockConn: SshConnection
  mockStore: SshRelaySessionTestStore
  mockPortForward: SshPortForwardManager
  getMainWindow: Mock<() => BrowserWindow | null>
  mockWindow: BrowserWindow
}

const persistedBindings = new WeakMap<SshRelaySessionStore, PersistPtyBindingArgs[]>()

export function recordedPtyBindings(store: SshRelaySessionStore): readonly PersistPtyBindingArgs[] {
  return persistedBindings.get(store) ?? []
}

export function createMockSshRelayStore(): SshRelaySessionTestStore {
  const bindings: PersistPtyBindingArgs[] = []
  const getWorkspaceSession = vi.fn<SshRelaySessionStore['getWorkspaceSession']>(
    getDefaultWorkspaceSession
  )
  const mockStore: SshRelaySessionTestStore = {
    getRepos: vi.fn().mockReturnValue([]),
    getSshTarget: vi.fn().mockReturnValue(undefined),
    getSshPtyConsumerRecovery: vi.fn().mockReturnValue(null),
    upsertSshPtyConsumerRecovery: vi.fn(),
    removeSshPtyConsumerRecovery: vi.fn(),
    getSshRemotePtyLeases: vi.fn().mockReturnValue([]),
    reconcileSshRemotePtyLeasesForTarget: vi.fn(),
    getWorkspaceSession,
    markDirectSshRemotePtyLease: vi.fn(),
    markSshRemotePtyLeases: vi.fn(),
    markSshRemotePtyLeasesAsync: vi.fn(),
    markSshRemotePtyLeasesForShutdown: vi.fn(),
    markSshRemotePtyLeasesAttachedAsync: vi.fn(),
    getSshRemotePtyKillIntents: vi.fn().mockReturnValue([]),
    pruneExpiredSshRemotePtyKillIntents: vi.fn(),
    recordSshRemotePtyKillIntent: vi.fn(),
    clearSshRemotePtyKillIntent: vi.fn(),
    noteSshRemotePtyKillReplayAttempt: vi.fn(),
    commitSshReattachPtyBinding: vi.fn<SshRelaySessionStore['commitSshReattachPtyBinding']>(
      async (target, input, isCurrent) => {
        if (!isCurrent()) {
          return null
        }
        const binding = resolveSshReattachPtyBinding(
          { ...input, worktreeId: target.id },
          getWorkspaceSession(target.hostId),
          getWorkspaceSession()
        )
        bindings.push(binding)
        return binding.tabId
      }
    )
  }
  persistedBindings.set(mockStore, bindings)
  return mockStore
}

export function createMockDeps(): SshRelaySessionTestDeps {
  const mockConn = {} as SshConnection
  const mockStore = createMockSshRelayStore()
  const mockPortForward = {
    removeAllForwards: vi.fn()
  } as unknown as SshPortForwardManager
  const mockWindow = {
    isDestroyed: () => false,
    // Why: the port scanner visibility-gates its ticks; a visible mock window
    // keeps establish-path tests exercising the scan-on-ready behavior.
    isVisible: () => true,
    isMinimized: () => false,
    webContents: { send: vi.fn() }
  } as unknown as BrowserWindow
  const getMainWindow = vi.fn().mockReturnValue(mockWindow)
  return { mockConn, mockStore, mockPortForward, getMainWindow, mockWindow }
}

export function mockDeploySuccess(): void {
  vi.mocked(deployAndLaunchRelay).mockResolvedValue({
    transport: {
      write: vi.fn(),
      onData: vi.fn(),
      onClose: vi.fn()
    },
    platform: 'linux-x64'
  })
}
