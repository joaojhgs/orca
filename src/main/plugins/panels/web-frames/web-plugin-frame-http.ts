import type { IncomingMessage, ServerResponse, RequestListener } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  allowsWebPluginFrameHost,
  resolveWebPluginFrame,
  WEB_PLUGIN_COOKIE,
  WEB_PLUGIN_ENTRY_PREFIX,
  webPluginFrameDomain
} from './web-plugin-frame-tickets'

export async function handleWebPluginFrameHttp(
  request: IncomingMessage,
  response: ServerResponse
): Promise<boolean> {
  const domain = webPluginFrameDomain()
  if (!domain) {
    return false
  }
  const url = new URL(request.url ?? '/', 'http://localhost')
  if (url.pathname === '/__orca_plugin_tls') {
    response.writeHead(allowsWebPluginFrameHost(url.searchParams.get('domain') ?? '') ? 200 : 403)
    response.end()
    return true
  }
  const host = request.headers.host?.toLowerCase()
  if (!host?.endsWith(`.${domain}`)) {
    return false
  }
  const deny = () => {
    response.writeHead(404, { 'Cache-Control': 'no-store' })
    response.end()
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    deny()
    return true
  }
  const parent = process.env.ORCA_PLUGIN_FRAME_PARENT_ORIGIN
  if (!parent || !/^https:\/\/[^/]+$/.test(parent)) {
    deny()
    return true
  }
  let token = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${WEB_PLUGIN_COOKIE}=`))
    ?.slice(WEB_PLUGIN_COOKIE.length + 1)
  let path = url.pathname
  if (path.startsWith(WEB_PLUGIN_ENTRY_PREFIX)) {
    const rest = path.slice(WEB_PLUGIN_ENTRY_PREFIX.length)
    const slash = rest.indexOf('/')
    token = rest.slice(0, slash)
    path = rest.slice(slash)
  }
  const ticket = token && /^[\w-]{43}$/.test(token) ? resolveWebPluginFrame(token, host) : null
  if (!ticket) {
    deny()
    return true
  }
  try {
    const headers = new Headers()
    for (const name of ['range', 'sec-fetch-mode', 'sec-fetch-dest']) {
      const value = request.headers[name]
      if (typeof value === 'string') {
        headers.set(name, value)
      }
    }
    const result = await ticket.handle(
      new Request(`orca-plugin-frame://${ticket.frameKey}${path}${url.search}`, {
        method: request.method,
        headers
      })
    )
    response.statusCode = result.status
    result.headers.forEach((value, key) => response.setHeader(key, value))
    response.setHeader(
      'Content-Security-Policy',
      `${result.headers.get('Content-Security-Policy') ?? "default-src 'none'"}; sandbox allow-scripts allow-same-origin; frame-ancestors ${parent}`
    )
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Origin-Agent-Cluster', '?1')
    response.setHeader('X-DNS-Prefetch-Control', 'off')
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), usb=(), serial=(), bluetooth=(), clipboard-read=(), clipboard-write=()'
    )
    response.setHeader(
      'Set-Cookie',
      `${WEB_PLUGIN_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict`
    )
    if (!result.body) {
      response.end()
    } else {
      const reader = result.body.getReader()
      await pipeline(
        Readable.from(
          (async function* () {
            try {
              for (;;) {
                const part = await reader.read()
                if (part.done) {
                  break
                }
                yield part.value
              }
            } finally {
              await reader.cancel().catch(() => undefined)
            }
          })()
        ),
        response
      )
    }
  } catch {
    if (!response.headersSent) {
      deny()
    } else {
      response.destroy()
    }
  }
  return true
}

export function withWebPluginFrames(next: RequestListener): RequestListener {
  return (request, response) => {
    void handleWebPluginFrameHttp(request, response)
      .then((handled) => {
        if (!handled) {
          next(request, response)
        }
      })
      .catch(() => {
        if (!response.headersSent) {
          response.writeHead(500)
        }
        response.end()
      })
  }
}
