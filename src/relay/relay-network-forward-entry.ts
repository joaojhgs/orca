// Compatibility client for already-running relays. Installing this companion
// does not replace or restart their daemon bundle or PTYs.
import { runRelayNetworkForward } from './relay-network-forward'
const marker = process.argv.indexOf('--orca-cli')
if (marker === -1) {
  throw new Error('Missing original relay CLI invocation')
}
void runRelayNetworkForward(
  process.argv.slice(marker + 1),
  process.argv.slice(2, marker + 1)
).catch(() => {
  console.error('Orca network forward failed; verify network routes and controller reachability')
  process.exitCode = 1
})
