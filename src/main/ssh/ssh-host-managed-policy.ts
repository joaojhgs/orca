import type { SshTarget } from '../../shared/ssh-types'

/** This fork retains its customized relay until the user explicitly migrates a host. */
export function keepCustomizedRelayOnConnect(
  target: Pick<SshTarget, 'orcadFence' | 'orcadProvisioning'>
): boolean {
  return target.orcadFence === undefined && target.orcadProvisioning === undefined
}
