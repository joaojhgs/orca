import { z } from 'zod'

export const NetworkForwardRoutesParams = z.object({}).strict()
export const NetworkForwardTicketParams = z.object({ routeId: z.string().min(1).max(80) }).strict()
export const NETWORK_FORWARD_CAPABILITY = 'network.agentForward.v1' as const
export const NETWORK_FORWARD_PATH = '/agent-port-forward'
export const NETWORK_FORWARD_MAX_BUFFER = 1024 * 1024
