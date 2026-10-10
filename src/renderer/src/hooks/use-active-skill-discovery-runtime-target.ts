import { useActiveRuntimeOwnerTarget } from './use-active-runtime-owner-target'

export function useActiveSkillDiscoveryRuntimeTarget() {
  return useActiveRuntimeOwnerTarget('legacy-single')
}
