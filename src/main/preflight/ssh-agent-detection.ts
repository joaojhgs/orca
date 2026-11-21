import { getSshAgentDetectionTransport } from '../ssh/targets/ssh-agent-detection-transport'
import { SshHostNotServedError } from '../providers/ssh-host-not-served-error'
import { KNOWN_TUI_AGENT_DETECTION_COMMANDS } from '../../shared/agent-launch/catalog/tui-agent-detection-commands'
import type { InstalledAgentDetectionOptions } from './installed-agent-detection'

type CommandProbe = { id: string; cmd: string; requiredCommands?: readonly string[] }

async function detectOnRelay(
  connectionId: string,
  commands: readonly CommandProbe[]
): Promise<string[]> {
  const mux = getSshAgentDetectionTransport(connectionId)
  if (!mux) {
    throw new SshHostNotServedError(connectionId)
  }
  const result = await mux.request('preflight.detectAgents', { commands })
  if (
    !result ||
    typeof result !== 'object' ||
    !('agents' in result) ||
    !Array.isArray(result.agents) ||
    result.agents.some((agent) => typeof agent !== 'string')
  ) {
    throw new Error('SSH agent detection returned an invalid inventory')
  }
  const allowed = new Set(commands.map(({ id }) => id))
  return [
    ...new Set(
      result.agents.filter((id): id is string => typeof id === 'string' && allowed.has(id))
    )
  ]
}

export function detectInstalledSshAgents(
  connectionId: string,
  options?: InstalledAgentDetectionOptions
): Promise<string[]> {
  const disabled = new Set(options?.disabledTuiAgents)
  return detectOnRelay(
    connectionId,
    KNOWN_TUI_AGENT_DETECTION_COMMANDS.filter(({ id }) => !disabled.has(id))
  )
}

export async function detectSshCommands(
  connectionId: string,
  commands: readonly string[]
): Promise<Set<string>> {
  return new Set(
    await detectOnRelay(
      connectionId,
      commands.map((cmd) => ({ id: cmd, cmd }))
    )
  )
}
