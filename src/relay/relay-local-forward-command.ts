import { runRelayCdpBrowserConnect } from './relay-cdp-browser-connect'
import { runRelayNetworkForward } from './relay-network-forward'

export function relayLocalForwardCommand(
  argv: string[],
  relayArguments: string[]
): Promise<void> | null {
  if (argv[0] === 'network' && argv[1] === 'forward') {
    return runRelayNetworkForward(argv, relayArguments)
  }
  if (argv[0] === 'computer' && argv[1] === 'browser-connect') {
    return runRelayCdpBrowserConnect(argv, relayArguments)
  }
  return null
}
