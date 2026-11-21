import { randomUUID } from 'node:crypto'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import https from 'node:https'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import tls from 'node:tls'

const TOKEN_QUERY = '__orca_proxy_token'
const TOKEN_COOKIE = '__orca_proxy'

export type WorkspaceWebProxySession = {
  port: number
  token: string
  path: string
}

type ProxyTarget = {
  origin: URL
  server: http.Server
  port: number
  tokens: Set<string>
}

export class WorkspaceWebProxyManager {
  private readonly targets = new Map<string, Promise<ProxyTarget>>()

  async open(rawUrl: string): Promise<WorkspaceWebProxySession> {
    const targetUrl = parseProxyTarget(rawUrl)
    const target = await this.getOrCreateTarget(targetUrl)
    const token = randomUUID()
    target.tokens.add(token)
    return {
      port: target.port,
      token,
      path: `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}` || '/'
    }
  }

  async dispose(): Promise<void> {
    const targets = await Promise.allSettled(this.targets.values())
    this.targets.clear()
    await Promise.all(
      targets.flatMap((result) =>
        result.status === 'fulfilled'
          ? [new Promise<void>((resolve) => result.value.server.close(() => resolve()))]
          : []
      )
    )
  }

  private async getOrCreateTarget(targetUrl: URL): Promise<ProxyTarget> {
    const key = targetUrl.origin
    const existing = this.targets.get(key)
    if (existing) {
      return existing
    }
    const pending = this.createTarget(new URL(key)).catch((error) => {
      this.targets.delete(key)
      throw error
    })
    this.targets.set(key, pending)
    return pending
  }

  private async createTarget(origin: URL): Promise<ProxyTarget> {
    const target: ProxyTarget = {
      origin,
      server: http.createServer(),
      port: 0,
      tokens: new Set()
    }
    target.server.on('request', (request, response) => this.proxyHttp(target, request, response))
    target.server.on('upgrade', (request, socket, head) =>
      this.proxyUpgrade(target, request, socket, head)
    )
    await new Promise<void>((resolve, reject) => {
      target.server.once('error', reject)
      target.server.listen(0, '0.0.0.0', () => {
        target.server.off('error', reject)
        resolve()
      })
    })
    const address = target.server.address()
    if (!address || typeof address === 'string') {
      target.server.close()
      throw new Error('workspace_web_proxy_bind_failed')
    }
    target.port = address.port
    return target
  }

  private proxyHttp(target: ProxyTarget, request: IncomingMessage, response: ServerResponse): void {
    const authorized = authorizeRequest(target, request)
    if (!authorized.ok) {
      response.statusCode = 403
      response.end('Forbidden')
      return
    }
    if (authorized.bootstrapToken) {
      response.statusCode = 302
      response.setHeader(
        'Set-Cookie',
        `${TOKEN_COOKIE}=${authorized.bootstrapToken}; HttpOnly; SameSite=Strict; Path=/`
      )
      response.setHeader('Location', authorized.cleanPath)
      response.end()
      return
    }

    const upstreamUrl = new URL(authorized.cleanPath, target.origin)
    const headers = upstreamHeaders(request.headers, target.origin)
    const transport = target.origin.protocol === 'https:' ? https : http
    const upstream = transport.request(
      upstreamUrl,
      { method: request.method, headers },
      (upstreamResponse) => {
        response.statusCode = upstreamResponse.statusCode ?? 502
        for (const [name, value] of Object.entries(upstreamResponse.headers)) {
          if (value === undefined || shouldStripResponseHeader(name)) {
            continue
          }
          if (name.toLowerCase() === 'location') {
            response.setHeader(name, rewriteLocation(value, target.origin))
          } else if (name.toLowerCase() === 'set-cookie') {
            response.setHeader(name, (Array.isArray(value) ? value : [value]).map(rewriteSetCookie))
          } else {
            response.setHeader(name, value)
          }
        }
        upstreamResponse.pipe(response)
      }
    )
    upstream.on('error', (error) => {
      if (!response.headersSent) {
        response.statusCode = 502
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
      }
      response.end(`Workspace app unavailable: ${error.message}`)
    })
    request.pipe(upstream)
  }

  private proxyUpgrade(
    target: ProxyTarget,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ): void {
    const authorized = authorizeRequest(target, request)
    if (!authorized.ok || authorized.bootstrapToken) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    const port = Number(target.origin.port) || (target.origin.protocol === 'https:' ? 443 : 80)
    const upstream =
      target.origin.protocol === 'https:'
        ? tls.connect({ host: target.origin.hostname, port, servername: target.origin.hostname })
        : net.connect({ host: target.origin.hostname, port })
    upstream.once('connect', () => {
      const headers = upstreamRawHeaders(request, target.origin)
      upstream.write(
        `${request.method ?? 'GET'} ${authorized.cleanPath} HTTP/1.1\r\n${headers}\r\n\r\n`
      )
      if (head.length > 0) {
        upstream.write(head)
      }
      socket.pipe(upstream).pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  }
}

function parseProxyTarget(rawUrl: string): URL {
  const target = new URL(rawUrl)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('workspace_web_proxy_requires_http')
  }
  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error('workspace_web_proxy_requires_loopback_target')
  }
  target.username = ''
  target.password = ''
  return target
}

function authorizeRequest(
  target: ProxyTarget,
  request: IncomingMessage
): { ok: false } | { ok: true; bootstrapToken: string | null; cleanPath: string } {
  const url = new URL(request.url ?? '/', 'http://orca.invalid')
  const queryToken = url.searchParams.get(TOKEN_QUERY)
  url.searchParams.delete(TOKEN_QUERY)
  const cleanPath = `${url.pathname}${url.search}`
  if (queryToken && target.tokens.has(queryToken)) {
    return { ok: true, bootstrapToken: queryToken, cleanPath }
  }
  const cookieToken = parseCookie(request.headers.cookie, TOKEN_COOKIE)
  return cookieToken && target.tokens.has(cookieToken)
    ? { ok: true, bootstrapToken: null, cleanPath }
    : { ok: false }
}

function parseCookie(rawCookie: string | undefined, name: string): string | null {
  for (const part of rawCookie?.split(';') ?? []) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) {
      return rest.join('=') || null
    }
  }
  return null
}

function upstreamHeaders(
  headers: IncomingMessage['headers'],
  origin: URL
): http.OutgoingHttpHeaders {
  const next = { ...headers, host: origin.host }
  delete next['content-security-policy']
  if (next.cookie) {
    next.cookie = next.cookie
      .split(';')
      .filter((part) => !part.trim().startsWith(`${TOKEN_COOKIE}=`))
      .join('; ')
  }
  return next
}

function upstreamRawHeaders(request: IncomingMessage, origin: URL): string {
  const lines: string[] = []
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index]
    let value = request.rawHeaders[index + 1]
    if (!name || value === undefined) {
      continue
    }
    if (name.toLowerCase() === 'host') {
      value = origin.host
    }
    if (name.toLowerCase() === 'cookie') {
      value = value
        .split(';')
        .filter((part) => !part.trim().startsWith(`${TOKEN_COOKIE}=`))
        .join('; ')
    }
    lines.push(`${name}: ${value}`)
  }
  return lines.join('\r\n')
}

function shouldStripResponseHeader(name: string): boolean {
  return [
    'x-frame-options',
    'content-security-policy',
    'content-security-policy-report-only'
  ].includes(name.toLowerCase())
}

function rewriteLocation(value: string | string[], origin: URL): string | string[] {
  const rewrite = (entry: string): string => {
    try {
      const location = new URL(entry, origin)
      return location.origin === origin.origin
        ? `${location.pathname}${location.search}${location.hash}`
        : entry
    } catch {
      return entry
    }
  }
  return Array.isArray(value) ? value.map(rewrite) : rewrite(value)
}

function rewriteSetCookie(value: string): string {
  return value.replace(/;\s*Domain=[^;]+/gi, '')
}

export const workspaceWebProxyManager = new WorkspaceWebProxyManager()
