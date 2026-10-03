import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { RuntimeClientTarget } from '../../runtime/runtime-rpc-client'
import { getRuntimeTargetHostId } from '../runtime-target-host'
import { getProjectGroupHostId } from '../slices/project-group-owner-routing'

export function projectGroupWithFetchedOwner(
  projectGroup: ProjectGroup,
  target: RuntimeClientTarget
): ProjectGroup {
  if (target.kind === 'environment') {
    return { ...projectGroup, executionHostId: getRuntimeTargetHostId(target) }
  }
  // Why: the web preload already stamps the paired owner even on the local API path.
  return { ...projectGroup, executionHostId: getProjectGroupHostId(projectGroup) }
}
