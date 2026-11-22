import type { Bot } from '../../shared/bot-types'
import { botOfHomeWorkspace } from '../../shared/bots/bot-homes'
import type { AgentSessionExecutionLocation } from '../../shared/agent-session/lifecycle/agent-session-record'

/** Only this linked bot's home is served by its remote profile. Other chats still probe locally. */
export function linkedHermesProfileForLocation(
  agent: string,
  location: AgentSessionExecutionLocation,
  bots: readonly Bot[]
) {
  return agent === 'hermes'
    ? (botOfHomeWorkspace(bots, location.workspaceId)?.hermesProfile ?? null)
    : null
}
