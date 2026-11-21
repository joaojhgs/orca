import { z } from 'zod'

/** Optional fresh-launch pretrust: the relay derives the preset from launchAgent and writes its own disk. Older relays ignore it, leaving the agent to ask. */
export type AgentWorkspaceTrustSpawnRequest = {
  workspacePath: string
}

const agentWorkspaceTrustSpawnRequestSchema = z.object({
  workspacePath: z.string().min(1)
})

export function parseAgentWorkspaceTrustSpawnRequest(
  value: unknown
): AgentWorkspaceTrustSpawnRequest | null {
  const parsed = agentWorkspaceTrustSpawnRequestSchema.safeParse(value)
  return parsed.success ? { workspacePath: parsed.data.workspacePath } : null
}
