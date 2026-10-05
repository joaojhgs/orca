import type { PreloadApi } from '../../../../preload/api-types'
import {
  DEFAULT_LOCAL_ORCA_PROFILE_ID,
  createDefaultLocalOrcaProfile
} from '../../../../shared/orca-profiles'
import { noopUnsubscribe } from './web-storage'
import type { OrcaProfileAuthStatus } from '../../../../shared/orca-profiles'
import { callRuntimeResult } from './web-runtime-calls'

export function createWebOrcaProfilesApi(): Partial<PreloadApi> {
  const webOrcaProfileAuthStatus = async (): Promise<OrcaProfileAuthStatus> => {
    try {
      return await callRuntimeResult<OrcaProfileAuthStatus>('artifacts.authStatus')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'method_not_found')) {
        throw error
      }
      return {
        activeProfileId: DEFAULT_LOCAL_ORCA_PROFILE_ID,
        configured: false,
        state: 'unconfigured' as const,
        persistence: 'none' as const,
        setupMessage:
          'Sign in to Orca Cloud on the host device. This older host cannot report account status to the browser.'
      }
    }
  }
  return {
    orcaProfiles: {
      list: () =>
        Promise.resolve({
          activeProfileId: DEFAULT_LOCAL_ORCA_PROFILE_ID,
          profiles: [createDefaultLocalOrcaProfile(0)],
          multiProfileUi: false
        }),
      authStatus: webOrcaProfileAuthStatus,
      onAuthStatusChanged: () => noopUnsubscribe,
      createLocal: () =>
        Promise.resolve({
          activeProfileId: DEFAULT_LOCAL_ORCA_PROFILE_ID,
          profiles: [createDefaultLocalOrcaProfile(0)],
          profile: createDefaultLocalOrcaProfile(0)
        }),
      createCloudLinked: async () => ({
        status: 'unconfigured',
        auth: await webOrcaProfileAuthStatus()
      }),
      switchProfile: () => Promise.resolve({ status: 'already-active' }),
      transferProject: (args) =>
        Promise.resolve({
          status: 'duplicate-target',
          sourceProfileId: args.sourceProfileId,
          targetProfileId: args.targetProfileId,
          sourceRepoId: args.repoId,
          duplicateRepoId: args.repoId
        }),
      findProjectProfiles: async () => ({ projects: [] }),
      connectCurrent: async () => ({
        status: 'unconfigured',
        auth: await webOrcaProfileAuthStatus()
      }),
      refreshAuth: async () => ({
        status: 'unconfigured',
        auth: await webOrcaProfileAuthStatus()
      }),
      signOutCurrent: async () => ({
        status: 'signed-out',
        auth: await webOrcaProfileAuthStatus(),
        activeProfileId: DEFAULT_LOCAL_ORCA_PROFILE_ID,
        profiles: [createDefaultLocalOrcaProfile(0)]
      }),
      selectOrg: async () => ({
        status: 'unconfigured',
        auth: await webOrcaProfileAuthStatus()
      }),
      orgMembersList: async () => ({ status: 'unconfigured' }),
      orgMemberInvite: async () => ({ status: 'unconfigured' }),
      orgInviteRevoke: async () => ({ status: 'unconfigured' }),
      orgMemberChangeRole: async () => ({ status: 'unconfigured' }),
      orgMemberRemove: async () => ({ status: 'unconfigured' })
    }
  }
}
