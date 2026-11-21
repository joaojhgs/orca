import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status/contracts/agent-status-types'
import type {
  TerminalLayoutSnapshot,
  TerminalTab
} from '../../../../shared/workspace-layout/terminal-tab-types'
import { applyAgentRowLineage } from '@/components/dashboard/rows/agent-row-lineage'
import { makePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import { buildWorktreeAgentRows } from './workspace-card/activity/worktree-agent-rows'

const LEAF_ID_1 = '22222222-2222-4222-8222-222222222222'
const PANE_KEY_1 = makePaneKey('tab-1', LEAF_ID_1)

function makeTab(id: string, overrides?: Partial<TerminalTab>): TerminalTab {
  return {
    id,
    worktreeId: 'wt-1',
    ptyId: null,
    title: 'Claude',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0,
    ...overrides
  }
}

function makeEntry(
  paneKey: string,
  startedAt: number,
  overrides?: Partial<AgentStatusEntry>
): AgentStatusEntry {
  return {
    paneKey,
    state: 'done',
    stateStartedAt: startedAt,
    updatedAt: startedAt,
    stateHistory: [],
    prompt: 'finished prompt',
    agentType: 'claude',
    terminalTitle: undefined,
    interrupted: false,
    ...overrides
  }
}

function makeSinglePaneLayout(leafId: string): TerminalLayoutSnapshot {
  return {
    root: { type: 'leaf', leafId },
    activeLeafId: leafId,
    expandedLeafId: null
  }
}

describe('worktree agent delivery', () => {
  it('refreshes legacy subagent evidence when the parent delivery clock advances', () => {
    const subagents = [{ id: 'a1', state: 'working' as const, startedAt: 1000 }]
    const firstEntry = makeEntry(PANE_KEY_1, 1000, { state: 'working', subagents })
    const tab = makeTab('tab-1')
    const firstRows = applyAgentRowLineage(
      buildWorktreeAgentRows({
        tabs: [tab],
        entries: [firstEntry],
        now: 2000
      })
    )
    const secondRows = applyAgentRowLineage(
      buildWorktreeAgentRows({
        tabs: [tab],
        entries: [{ ...firstEntry, updatedAt: 2500, toolName: 'Read' }],
        now: 2500
      })
    )

    expect(secondRows.find((row) => row.rowSource === 'subagent')).not.toBe(
      firstRows.find((row) => row.rowSource === 'subagent')
    )
    expect(secondRows.find((row) => row.rowSource === 'subagent')).toMatchObject({
      state: 'working',
      entry: { updatedAt: 2500 },
      childRow: { recencyAt: 2500 }
    })
  })

  it('shows a completed Cursor turn as idle while its pane PTY remains live', () => {
    const entry = makeEntry(PANE_KEY_1, 1000, { agentType: 'cursor', state: 'done' })
    const rows = buildWorktreeAgentRows({
      tabs: [makeTab('tab-1')],
      entries: [entry],
      ptyIdsByTabId: { 'tab-1': ['pty-cursor'] },
      terminalLayoutsByTabId: {
        'tab-1': {
          ...makeSinglePaneLayout(LEAF_ID_1),
          ptyIdsByLeafId: { [LEAF_ID_1]: 'pty-cursor' }
        }
      },
      now: 2000
    })

    expect(rows.find((row) => row.paneKey === PANE_KEY_1)?.state).toBe('idle')
  })

  it('keeps a completed Cursor turn done after its pane PTY exits', () => {
    const entry = makeEntry(PANE_KEY_1, 1000, { agentType: 'cursor', state: 'done' })
    const rows = buildWorktreeAgentRows({
      tabs: [makeTab('tab-1')],
      entries: [entry],
      ptyIdsByTabId: { 'tab-1': [] },
      terminalLayoutsByTabId: {
        'tab-1': {
          ...makeSinglePaneLayout(LEAF_ID_1),
          ptyIdsByLeafId: { [LEAF_ID_1]: 'pty-cursor' }
        }
      },
      now: 2000
    })

    expect(rows.find((row) => row.paneKey === PANE_KEY_1)?.state).toBe('done')
  })
})
