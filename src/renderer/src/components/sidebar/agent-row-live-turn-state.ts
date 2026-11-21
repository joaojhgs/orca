import type { DashboardAgentRow } from '@/components/dashboard/rows/dashboard-agent-row'
import type { AgentStatusEntry } from '../../../../shared/agent-status/contracts/agent-status-types'
import type { TerminalLayoutSnapshot } from '../../../../shared/workspace-layout/terminal-tab-types'
import { parsePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'

export function resolveAgentRowLiveTurnState(args: {
  entry: AgentStatusEntry
  ptyIdsByTabId?: Record<string, string[]>
  terminalLayoutsByTabId?: Record<string, TerminalLayoutSnapshot | undefined>
}): DashboardAgentRow['state'] {
  if (args.entry.state !== 'done' || args.entry.agentType !== 'cursor') {
    return args.entry.state
  }
  const pane = parsePaneKey(args.entry.paneKey)
  if (!pane) {
    return args.entry.state
  }
  const panePtyId = args.terminalLayoutsByTabId?.[pane.tabId]?.ptyIdsByLeafId?.[pane.leafId]
  return panePtyId && args.ptyIdsByTabId?.[pane.tabId]?.includes(panePtyId)
    ? 'idle'
    : args.entry.state
}
