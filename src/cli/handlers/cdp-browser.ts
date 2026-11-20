import type { CommandHandler } from '../dispatch'
import { getRequiredStringFlag, getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import type { CdpBrowserTarget } from '../../shared/cdp-relay-contract'
import { readCdpLocalToken, startCdpLocalProxy } from './cdp-local-proxy'

export const CDP_BROWSER_HANDLERS: Record<string, CommandHandler> = {
  'computer browsers': async ({ client, json }) => {
    const result = await client.call<{ targets: CdpBrowserTarget[] }>('computer.browserTargets', {})
    printResult(result, json, (value) =>
      value.targets
        .map(
          (t) =>
            `${t.id}  ${t.label} (${t.humanControl ? 'human control; agents paused' : 'CDP available'})`
        )
        .join('\n')
    )
  },
  'computer browser-connect': async ({ flags, client, json }) => {
    const browserId = getRequiredStringFlag(flags, 'browser')
    const port = Number(getOptionalStringFlag(flags, 'port') ?? 0)
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error('Invalid loopback port')
    const proxy = await startCdpLocalProxy({
      port,
      token: readCdpLocalToken(getOptionalStringFlag(flags, 'token-file')),
      ticket: async () =>
        (
          await client.call<{ url: string }>(
            'computer.browserTicket',
            { browserId },
            { timeoutMs: 30000 }
          )
        ).result.url
    })
    console.log(
      json
        ? JSON.stringify({ browserId, endpoint: proxy.endpoint, loopbackOnly: true })
        : proxy.endpoint
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
