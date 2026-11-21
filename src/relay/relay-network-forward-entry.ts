// Compatibility client for already-running relays. Installing this companion
// does not replace or restart their daemon bundle or PTYs.
import { relayLocalForwardCommand } from './relay-local-forward-command'

const marker = process.argv.indexOf('--orca-cli')
if (marker === -1) {
  throw new Error('Missing original relay CLI invocation')
}
const argv = process.argv.slice(marker + 1)
const command = relayLocalForwardCommand(argv, process.argv.slice(2, marker + 1))
if (!command) {
  throw new Error('Unsupported relay forwarding command')
}
void command.catch(() => {
  console.error(
    argv[0] === 'computer'
      ? 'Orca could not start the local browser connection. Check computer browsers and browser-connect --help.'
      : 'Orca network forward failed; verify network routes and controller reachability'
  )
  process.exitCode = 1
})
