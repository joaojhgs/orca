import { getSshGitProvider, requireSshGitProvider } from '../../providers/ssh-git-dispatch'
import {
  getSshProviderAuthority,
  isCurrentSshProviderAuthority
} from '../../ssh/connection/authority/ssh-provider-authority'
import { getActiveMultiplexer } from '../../ssh/targets/ssh-target-registry'
import { getActiveSshHostHomeDirectory } from '../ssh/ssh-active-relay-sessions'
import { executionHostRemovalHome } from '../../workspaces/removal/worktree-removal-home-guard'

export type DirectSshWorktreeAuthority = ReturnType<typeof captureDirectSshWorktreeAuthority>

export function captureDirectSshWorktreeAuthority(connectionId: string) {
  const provider = requireSshGitProvider(connectionId)
  const authority = getSshProviderAuthority(connectionId)
  const assertCurrent = (): void => {
    if (getSshGitProvider(connectionId) !== provider || !isCurrentSshProviderAuthority(authority)) {
      throw new Error('SSH worktree connection changed. Reconnect and try again.')
    }
  }
  return {
    connectionId,
    provider,
    authority,
    assertCurrent,
    removalHome: () => executionHostRemovalHome(getActiveSshHostHomeDirectory(connectionId)),
    registerRoot: async (rootPath: string): Promise<void> => {
      assertCurrent()
      const mux = getActiveMultiplexer(connectionId)
      if (!mux) {
        throw new Error('SSH connection is not available. Please reconnect and try again.')
      }
      try {
        await mux.request('session.registerRoot', { rootPath })
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('Method not found')) {
          throw error
        }
        assertCurrent()
        mux.notify('session.registerRoot', { rootPath })
      }
      assertCurrent()
    }
  }
}
