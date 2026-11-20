import type { CommandHandler } from '../dispatch'
import { getRequiredStringFlag, getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import { startLocalNetworkForward } from './network-forward-local'

export const NETWORK_HANDLERS: Record<string, CommandHandler> = {
  'network routes': async ({ client, json }) => {
    const result = await client.call('network.forwardRoutes', {})
    printResult(result, json, (value) => JSON.stringify(value, null, 2))
  },
  'network ticket': async ({ client, flags, json }) => {
    const result = await client.call('network.forwardTicket', {
      routeId: getRequiredStringFlag(flags, 'route')
    })
    printResult(result, json, (value) => JSON.stringify(value))
  },
  'network forward': async ({ client, flags, json }) => {
    const routeId = getRequiredStringFlag(flags, 'route')
    const port = Number(getOptionalStringFlag(flags, 'local-port') ?? 0)
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error('Invalid local port')
    }
    // Fail before publishing a loopback address if the route is absent or its host disconnected.
    const mint = async () =>
      (
        await client.call<{ url: string; connectAddress?: string }>('network.forwardTicket', {
          routeId
        })
      ).result
    await mint()
    // A listener may sit idle longer than the 30-second ticket lifetime. Never cache tickets.
    const proxy = await startLocalNetworkForward({ port, ticket: mint })
    console.log(
      json
        ? JSON.stringify({
            ok: true,
            routeId,
            host: proxy.host,
            port: proxy.port,
            endpoint: `127.0.0.1:${proxy.port}`,
            loopbackOnly: true
          })
        : `127.0.0.1:${proxy.port}`
    )
    await new Promise<void>((resolve) => {
      const stop = () => {
        proxy.close()
        resolve()
      }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    })
  }
}
