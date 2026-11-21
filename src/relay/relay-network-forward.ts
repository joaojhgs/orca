import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { startLocalNetworkForward } from '../cli/network/network-forward-local'

const execute = promisify(execFile)

// This runs in the calling host's CLI process, NEVER the long-lived relay daemon
// or the controller's buffered CLI child. Old relays can use the standalone entry.
export async function runRelayNetworkForward(argv: string[], relayArguments: string[]) {
  if (argv.includes('--help')) {
    console.log(
      'Usage: orca network forward --route <approved-id> [--local-port <port>] [--json]\nRuns on this host until SIGINT/SIGTERM. Discover approved destinations with orca network routes --json.'
    )
    return
  }
  const values = new Map<string, string>()
  let json = false
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--json') {
      json = true
      continue
    }
    if (!['--route', '--local-port'].includes(flag) || values.has(flag) || !argv[i + 1]) {
      throw new Error(
        'Usage: orca network forward --route <approved-id> [--local-port <port>] [--json]'
      )
    }
    values.set(flag, argv[++i])
  }
  const routeId = values.get('--route')
  const port = Number(values.get('--local-port') ?? 0)
  if (!routeId || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('Invalid route or local port')
  }
  const ticket = async () => {
    const { stdout } = await execute(
      process.execPath,
      [...relayArguments, 'network', 'ticket', '--route', routeId, '--json'],
      { timeout: 30000, maxBuffer: 65536 }
    )
    const response: unknown = JSON.parse(stdout)
    if (
      !response ||
      typeof response !== 'object' ||
      !('ok' in response) ||
      response.ok !== true ||
      !('result' in response) ||
      !response.result ||
      typeof response.result !== 'object' ||
      !('url' in response.result) ||
      typeof response.result.url !== 'string'
    ) {
      throw new Error('Orca did not confirm the approved forward ticket')
    }
    const connectAddress =
      'connectAddress' in response.result && typeof response.result.connectAddress === 'string'
        ? response.result.connectAddress
        : undefined
    return { url: response.result.url, connectAddress }
  }
  await ticket()
  const proxy = await startLocalNetworkForward({ port, ticket })
  const receipt = {
    ok: true,
    routeId,
    host: proxy.host,
    port: proxy.port,
    endpoint: `127.0.0.1:${proxy.port}`,
    loopbackOnly: true
  }
  console.log(json ? JSON.stringify(receipt) : receipt.endpoint)
  await new Promise<void>((resolve) => {
    const stop = () => {
      proxy.close()
      resolve()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}
