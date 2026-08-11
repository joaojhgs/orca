import {
  AGENT_MODEL_MAX_LENGTH,
  AGENT_STATUS_MAX_SUBAGENTS,
  AGENT_STATUS_TOOL_INPUT_MAX_LENGTH,
  AGENT_TYPE_MAX_LENGTH,
  type AgentSubagentSnapshot
} from './agent-status-types'
import { normalizeOptionalField } from './agent-status-field-normalization'

const CODEX_SUBAGENT_ID_MAX_LENGTH = 64

export type CodexSubagentRoster = Map<string, TrackedCodexSubagent>

type TrackedCodexSubagent = {
  agentType?: string
  description?: string
  model?: string
  state: 'working' | 'waiting' | 'idle'
  startedAt: number
  transcriptPath?: string
}

export function upsertCodexSubagent(
  roster: CodexSubagentRoster,
  id: string,
  fields: {
    agentType?: string
    description?: string
    model?: string
    state: 'working' | 'waiting' | 'idle'
    transcriptPath?: string
  },
  now: number
): void {
  const normalizedId = id.trim()
  if (normalizedId.length === 0 || normalizedId.length > CODEX_SUBAGENT_ID_MAX_LENGTH) {
    return
  }
  const agentType = normalizeOptionalField(fields.agentType, AGENT_TYPE_MAX_LENGTH)
  const description = normalizeOptionalField(fields.description, AGENT_STATUS_TOOL_INPUT_MAX_LENGTH)
  const model = normalizeOptionalField(fields.model, AGENT_MODEL_MAX_LENGTH)
  const existing = roster.get(normalizedId)
  if (existing) {
    existing.agentType = agentType ?? existing.agentType
    existing.description = description ?? existing.description
    existing.model = model ?? existing.model
    existing.state = fields.state
    existing.transcriptPath = fields.transcriptPath ?? existing.transcriptPath
    return
  }
  if (roster.size >= AGENT_STATUS_MAX_SUBAGENTS) {
    const completed = [...roster].find(([, tracked]) => tracked.state === 'idle')
    if (!completed) {
      return
    }
    roster.delete(completed[0])
  }
  roster.set(normalizedId, {
    agentType,
    description,
    model,
    state: fields.state,
    startedAt: now,
    transcriptPath: fields.transcriptPath
  })
}

export function finishCodexSubagent(
  roster: CodexSubagentRoster,
  id: string,
  fields: { transcriptPath?: string } = {}
): void {
  const tracked = roster.get(id.trim())
  if (!tracked) {
    return
  }
  tracked.state = 'idle'
  tracked.transcriptPath = fields.transcriptPath ?? tracked.transcriptPath
}

export function seedCodexSubagentRoster(
  roster: CodexSubagentRoster,
  snapshots: readonly AgentSubagentSnapshot[]
): void {
  for (const snapshot of snapshots) {
    if (snapshot.state !== 'working' && snapshot.state !== 'waiting' && snapshot.state !== 'idle') {
      continue
    }
    upsertCodexSubagent(
      roster,
      snapshot.id,
      {
        agentType: snapshot.agentType,
        description: snapshot.description,
        model: snapshot.model,
        state: snapshot.state,
        transcriptPath: snapshot.transcriptPath
      },
      snapshot.startedAt
    )
  }
}

export function codexRosterToSnapshots(
  roster: CodexSubagentRoster | undefined
): AgentSubagentSnapshot[] | undefined {
  if (!roster || roster.size === 0) {
    return undefined
  }
  const snapshots = Array.from(roster, ([id, tracked]) => ({
    id,
    agentType: tracked.agentType,
    description: tracked.description,
    model: tracked.model,
    state: tracked.state,
    startedAt: tracked.startedAt,
    transcriptPath: tracked.transcriptPath
  }))
  snapshots.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
  return snapshots
}

export function codexRosterEffectiveState(
  roster: CodexSubagentRoster | undefined,
  leadState: 'working' | 'waiting' | 'done'
): 'working' | 'waiting' | 'done' {
  if (!roster || roster.size === 0) {
    return leadState
  }
  for (const tracked of roster.values()) {
    if (tracked.state === 'waiting') {
      return 'waiting'
    }
  }
  return leadState === 'done' ? 'working' : leadState
}
