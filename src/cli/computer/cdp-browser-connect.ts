import { readCdpLocalToken, startCdpLocalProxy } from './cdp-local-proxy'

export async function runCdpBrowserConnect(options: {
  browserId: string
  port?: string
  tokenFile?: string
  json: boolean
  ticket: () => Promise<string>
}): Promise<void> {
  const port = Number(options.port ?? 0)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('Invalid loopback port')
  }
  const proxy = await startCdpLocalProxy({
    port,
    token: readCdpLocalToken(options.tokenFile),
    ticket: options.ticket
  })
  await new Promise<void>((resolve) => {
    const stop = () => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      proxy.close()
      resolve()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    console.log(
      options.json
        ? JSON.stringify({
            browserId: options.browserId,
            endpoint: proxy.endpoint,
            loopbackOnly: true
          })
        : proxy.endpoint
    )
  })
}
