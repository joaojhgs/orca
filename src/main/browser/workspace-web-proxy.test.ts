import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { WorkspaceWebProxyManager } from './workspace-web-proxy'

const managers: WorkspaceWebProxyManager[] = []
const servers: http.Server[] = []

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.dispose()))
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  )
})

describe('WorkspaceWebProxyManager', () => {
  it('proxies authenticated HTTP and WebSocket traffic to a loopback app', async () => {
    const upstream = http.createServer((request, response) => {
      response.setHeader('X-Frame-Options', 'DENY')
      response.end(`hello:${request.url}`)
    })
    const upstreamWs = new WebSocketServer({ noServer: true })
    upstream.on('upgrade', (request, socket, head) => {
      upstreamWs.handleUpgrade(request, socket, head, (client) => {
        client.on('message', (message) => client.send(`echo:${message.toString()}`))
      })
    })
    await listen(upstream, '127.0.0.1')
    servers.push(upstream)

    const upstreamPort = addressPort(upstream)
    const manager = new WorkspaceWebProxyManager()
    managers.push(manager)
    const session = await manager.open(`http://127.0.0.1:${upstreamPort}/app?q=1`)

    const bootstrap = await request(
      session.port,
      `${session.path}&__orca_proxy_token=${session.token}`
    )
    expect(bootstrap.status).toBe(302)
    expect(bootstrap.location).toBe('/app?q=1')
    const cookie = bootstrap.cookie
    expect(cookie).toContain('__orca_proxy=')

    const proxied = await request(session.port, '/asset.js', cookie)
    expect(proxied.status).toBe(200)
    expect(proxied.body).toBe('hello:/asset.js')
    expect(proxied.xFrameOptions).toBeUndefined()

    const ws = new WebSocket(`ws://127.0.0.1:${session.port}/hmr`, { headers: { cookie } })
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => {
        ws.send('ping')
      })
      ws.once('message', (message) => {
        expect(message.toString()).toBe('echo:ping')
        ws.close()
        resolve()
      })
      ws.once('error', reject)
    })
  })

  it('rejects non-loopback targets', async () => {
    const manager = new WorkspaceWebProxyManager()
    managers.push(manager)
    await expect(manager.open('https://example.com')).rejects.toThrow(
      'workspace_web_proxy_requires_loopback_target'
    )
  })
})

async function listen(server: http.Server, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, () => resolve())
  })
}

function addressPort(server: http.Server): number {
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('server_not_listening')
  }
  return address.port
}

async function request(
  port: number,
  path: string,
  cookie?: string
): Promise<{
  status: number
  body: string
  cookie: string
  location: string | undefined
  xFrameOptions: string | string[] | undefined
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, headers: cookie ? { cookie } : undefined },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            cookie: response.headers['set-cookie']?.[0]?.split(';')[0] ?? '',
            location: response.headers.location,
            xFrameOptions: response.headers['x-frame-options']
          })
        })
      }
    )
    req.once('error', reject)
    req.end()
  })
}
