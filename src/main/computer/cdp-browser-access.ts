import { randomBytes } from 'node:crypto'
import { request } from 'node:http'
import { z } from 'zod'
import { openDesktopSshRoute } from './ssh-desktop-vnc-route'
import {
  cdpBrowserIsCurrent,
  resolveCdpBrowser,
  type ApprovedCdpBrowser
} from './cdp-browser-policy'
import { CdpRouteSocket } from './cdp-route-socket'

const tickets = new Map<
  string,
  { target: ApprovedCdpBrowser & { debuggerPath: string }; expiresAt: number }
>()
export async function openCdpBrowserRoute(target: ApprovedCdpBrowser, signal?: AbortSignal) {
  if (!cdpBrowserIsCurrent(target))
    throw new Error('Browser control is paused or its authority expired')
  const route = await openDesktopSshRoute(target.authority, signal)
  if (!route.isValid() || !cdpBrowserIsCurrent(target)) {
    await route.close()
    throw new Error('Browser authority expired')
  }
  return route
}

export function validateCdpDebuggerPath(value: string, port: number): string {
  const url = new URL(value)
  if (
    url.protocol !== 'ws:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    Number(url.port) !== port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(url.pathname)
  ) {
    throw new Error('Browser returned an invalid debugging endpoint')
  }
  return url.pathname
}

export async function discoverCdpDebugger(target: ApprovedCdpBrowser, signal?: AbortSignal) {
  const route = await openCdpBrowserRoute(target, signal)
  try {
    const path = await new Promise<string>((resolve, reject) => {
      const socket = new CdpRouteSocket(route.connect({ host: '127.0.0.1', port: target.port }))
      const deadline = AbortSignal.any([AbortSignal.timeout(12000), ...(signal ? [signal] : [])])
      const req = request(
        {
          hostname: '127.0.0.1',
          port: target.port,
          path: '/json/version',
          signal: deadline,
          createConnection: () => socket
        },
        (response) => {
          let bytes = 0
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length
            if (bytes > 64 * 1024) req.destroy(new Error('Browser discovery response too large'))
            else chunks.push(chunk)
          })
          response.on('error', reject)
          response.on('end', () => {
            try {
              if (response.statusCode !== 200) throw new Error('Browser discovery failed')
              const value = z
                .object({ webSocketDebuggerUrl: z.string() })
                .parse(JSON.parse(Buffer.concat(chunks).toString()))
              resolve(validateCdpDebuggerPath(value.webSocketDebuggerUrl, target.port))
            } catch (error) {
              reject(error)
            }
          })
        }
      )
      req.on('error', reject)
      req.end()
    })
    if (!cdpBrowserIsCurrent(target)) throw new Error('Browser authority expired')
    return path
  } finally {
    await route.close()
  }
}

export async function mintCdpBrowserTicket(browserId: string) {
  const target = resolveCdpBrowser(browserId)
  if (!target.publicOrigin) throw new Error('CDP public origin is not configured by the owner')
  const debuggerPath = await discoverCdpDebugger(target)
  for (const [key, value] of tickets) if (value.expiresAt < Date.now()) tickets.delete(key)
  if (tickets.size >= 64) throw new Error('Too many pending browser connections')
  const ticket = randomBytes(32).toString('base64url')
  tickets.set(ticket, { target: { ...target, debuggerPath }, expiresAt: Date.now() + 30000 })
  return {
    browserId,
    path: '/browser-cdp?ticket=' + ticket,
    url:
      new URL(target.publicOrigin).origin.replace(/^https:/, 'wss:') +
      '/browser-cdp?ticket=' +
      ticket,
    debuggerPath
  }
}
export function consumeCdpBrowserTicket(ticket: string) {
  const saved = tickets.get(ticket)
  tickets.delete(ticket)
  return saved && saved.expiresAt >= Date.now() && cdpBrowserIsCurrent(saved.target)
    ? saved.target
    : null
}
