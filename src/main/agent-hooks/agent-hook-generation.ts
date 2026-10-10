import { createHash } from 'node:crypto'
import type { EnrichedAgentHookEventPayload } from './server/server-types'

export function agentHookGeneration(event: EnrichedAgentHookEventPayload): string {
  const identity =
    event.launchToken ??
    (event.observation
      ? `${event.observation.authorityId}:${event.observation.incarnation}`
      : (event.providerSession?.id ?? 'legacy'))
  return createHash('sha256').update(identity).digest('hex')
}
