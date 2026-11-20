import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const NETWORK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['network', 'routes'],
    summary: 'List owner-approved cross-host TCP relay destinations',
    usage: 'orca network routes [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['network', 'ticket'],
    summary:
      'Mint one short-lived TCP connection ticket (sensitive; used by the local relay client)',
    usage: 'orca network ticket --route <route-id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'route']
  },
  {
    path: ['network', 'forward'],
    summary: 'Forward a local loopback TCP port through the owning Orca server',
    usage: 'orca network forward --route <route-id> [--local-port <port>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'route', 'local-port'],
    notes: [
      'Runs until SIGINT/SIGTERM; zero selects an available loopback port. HTTP, TLS, WebSocket and other TCP protocols are byte-transparent.',
      'No public listener or direct execution-host route is needed. The destination host/port must be approved in the controller network-forward-policy.json.',
      'Each connection receives a short-lived one-use ticket. Revoking the route or disconnecting its SSH host closes existing streams.',
      'Use network routes to discover the exact destination before starting. Keep the forward process running for the duration of the test.'
    ]
  }
]
