import { defineMethod } from '../core'
import {
  NetworkForwardRoutesParams,
  NetworkForwardTicketParams
} from '../../../../shared/network-forward-contract'
import {
  mintAgentForwardTicket,
  readAgentForwardPolicy,
  resolveAgentForward
} from '../../../ports/agent-forward-access'

export const NETWORK_FORWARD_METHODS = [
  defineMethod({
    name: 'network.forwardRoutes',
    permission: 'workspace',
    params: NetworkForwardRoutesParams,
    handler: () => ({
      routes: readAgentForwardPolicy().routes.map((route) => {
        let reachable = false
        try {
          resolveAgentForward(route.id)
          reachable = true
        } catch {
          /* Disconnection is not deletion. */
        }
        return { ...route, reachable }
      })
    })
  }),
  defineMethod({
    name: 'network.forwardTicket',
    permission: 'workspace',
    params: NetworkForwardTicketParams,
    handler: (params) => mintAgentForwardTicket(params.routeId)
  })
]
