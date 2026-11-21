import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getRequiredStringFlag, getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import type { CdpBrowserTarget } from '../../shared/cdp-relay-contract'
import { runCdpBrowserConnect } from './cdp-browser-connect'

function requestBrowserTicket(client: HandlerContext['client'], browserId: string) {
  return client.call<{ browserId: string; url: string }>(
    'computer.browserTicket',
    { browserId },
    { timeoutMs: 30_000 }
  )
}

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
  'computer browser-ticket': async ({ flags, client, json }) => {
    const browserId = getRequiredStringFlag(flags, 'browser')
    const result = await requestBrowserTicket(client, browserId)
    printResult(result, json, (ticket) => ticket.url)
  },
  'computer browser-connect': async ({ flags, client, json }) => {
    const browserId = getRequiredStringFlag(flags, 'browser')
    await runCdpBrowserConnect({
      browserId,
      port: getOptionalStringFlag(flags, 'port'),
      tokenFile: getOptionalStringFlag(flags, 'token-file'),
      json,
      ticket: async () => (await requestBrowserTicket(client, browserId)).result.url
    })
  }
}
