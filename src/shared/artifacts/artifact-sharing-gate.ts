// Public artifact URLs require a user-granted capability; main/CLI/Settings share this gate.
import type { GlobalSettings } from '../settings/global-settings-types'

export const ARTIFACT_SHARING_DISABLED_CODE = 'artifact_sharing_disabled'

// The gate has no caller identity and also denies human CLI sharing; wording must describe device-wide permission.
export const ARTIFACT_SHARING_DISABLED_MESSAGE =
  'Publishing artifacts is off for this device. Nothing running here — agents or the orca CLI — can mint public artifact links until you allow it.'

export const ARTIFACT_SHARING_DISABLED_NEXT_STEPS: readonly string[] = [
  'Open Settings → Artifacts on this device, or in its paired browser.',
  'Enable publishing in the desktop app, or request headless approval and run the one-time SSH command yourself. Agents must not execute the approval command.',
  'Run the share command again.'
]

export class ArtifactSharingDisabledError extends Error {
  readonly code = ARTIFACT_SHARING_DISABLED_CODE
  readonly data = { nextSteps: [...ARTIFACT_SHARING_DISABLED_NEXT_STEPS] }

  constructor() {
    super(ARTIFACT_SHARING_DISABLED_MESSAGE)
    this.name = 'ArtifactSharingDisabledError'
  }
}

/** Only explicit `true` grants: new profiles store it from defaults; absent or `false` denies. */
export function isArtifactSharingEnabled(
  settings: Pick<GlobalSettings, 'artifactSharingEnabled'> | null | undefined
): boolean {
  return settings?.artifactSharingEnabled === true
}

export function assertArtifactSharingAllowed(isEnabled: () => boolean): void {
  if (!isEnabled()) {
    throw new ArtifactSharingDisabledError()
  }
}
