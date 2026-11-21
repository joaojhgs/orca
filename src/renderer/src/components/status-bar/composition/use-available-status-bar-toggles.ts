import { useAppStore } from '../../../store/index'
import type { StatusBarItem } from '../../../../../shared/ui-chrome/ui-chrome-types'
import { isStatusBarItemAvailable, withExecutionAgentIds } from './status-bar-agent-gating'

/** Keep CLI toggles visible until detection proves their agent missing. */
export function useAvailableStatusBarToggles<T extends { id: StatusBarItem }>(
  toggles: readonly T[]
): T[] {
  const detectedAgentIds = useAppStore((s) => s.detectedAgentIds)
  const accounts = useAppStore((s) => s.rateLimits.executionAccounts)
  const availableAgents = withExecutionAgentIds(detectedAgentIds, accounts)
  return toggles.filter((t) => isStatusBarItemAvailable(t.id, availableAgents))
}
