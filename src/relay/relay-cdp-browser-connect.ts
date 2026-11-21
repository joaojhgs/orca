import { runProcess } from '@orca/process-host'
import { parseArgs } from 'node:util'
import { runCdpBrowserConnect } from '../cli/computer/cdp-browser-connect'

const BROWSER_CONNECT_USAGE =
  'Usage: orca computer browser-connect --browser <id> [--port <n>] [--token-file <private-file>] [--json]'

export async function runRelayCdpBrowserConnect(
  argv: readonly string[],
  relayArguments: readonly string[]
): Promise<void> {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      browser: { type: 'string' },
      port: { type: 'string' },
      'token-file': { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  })
  if (values.help) {
    console.log(BROWSER_CONNECT_USAGE)
    return
  }
  const browserId = values.browser?.trim()
  if (!browserId) {
    throw new Error(BROWSER_CONNECT_USAGE)
  }
  await runCdpBrowserConnect({
    browserId,
    port: values.port,
    tokenFile: values['token-file'],
    json: values.json === true,
    ticket: () => requestRelayBrowserTicket(relayArguments, browserId)
  })
}

async function requestRelayBrowserTicket(
  relayArguments: readonly string[],
  browserId: string
): Promise<string> {
  const result = await runProcess({
    program: process.execPath,
    args: [...relayArguments, 'computer', 'browser-ticket', '--browser', browserId, '--json'],
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
    killOnOutputLimit: true
  })
  if (result.code !== 0 || result.outputTruncated) {
    throw new Error('Orca did not confirm the approved browser ticket')
  }
  const response: unknown = JSON.parse(result.stdout)
  if (
    !response ||
    typeof response !== 'object' ||
    !('ok' in response) ||
    response.ok !== true ||
    !('result' in response) ||
    !response.result ||
    typeof response.result !== 'object' ||
    !('browserId' in response.result) ||
    response.result.browserId !== browserId ||
    !('url' in response.result) ||
    typeof response.result.url !== 'string'
  ) {
    throw new Error('Orca did not confirm the approved browser ticket')
  }
  return response.result.url
}
