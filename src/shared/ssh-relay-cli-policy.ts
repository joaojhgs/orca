import type { SshTarget } from './ssh-types'

/** Preserve legacy relay coordination; explicit restrictions and managed hosts remain opt-in. */
export function isRelayCliControlEnabled(
  target: Pick<SshTarget, 'allowRemoteCliControl' | 'orcadFence' | 'orcadProvisioning'> | undefined
): boolean {
  if (!target) {
    return false
  }
  return (
    target.allowRemoteCliControl ??
    (target.orcadFence === undefined && target.orcadProvisioning === undefined)
  )
}
