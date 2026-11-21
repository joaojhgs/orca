import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { WebSocket, WebSocketServer } from 'ws'

export function readCdpLocalToken(path?: string): string {
  const token = randomBytes(32).toString('base64url')
  if (!path) {
    return token
  }
  try {
    writeFileSync(path, token, { mode: 0o600, flag: 'wx' })
    return token
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
      throw error
    }
  }
  const invalidToken = () =>
    new Error('CDP local token must be an owner-only regular file containing one 32-byte token')
  if (!lstatSync(path).isFile()) {
    throw invalidToken()
  }
  const fd = openSync(
    path,
    constants.O_RDONLY |
      (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK)
  )
  try {
    const stat = fstatSync(fd)
    if (
      !stat.isFile() ||
      stat.size > 128 ||
      (process.platform !== 'win32' &&
        ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
    ) {
      throw invalidToken()
    }
    const existing = readFileSync(fd, 'utf8').trim()
    if (!/^[A-Za-z0-9_-]{43}$/.test(existing)) {
      throw invalidToken()
    }
    return existing
  } finally {
    closeSync(fd)
  }
}

export async function startCdpLocalProxy(options: {
  port: number
  token: string
  ticket: () => Promise<string>
}) {
  const clients = new Set<WebSocket>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 })
  let endpoint = ''
  const server = createServer((req, res) => {
    if (
      req.headers.origin ||
      req.headers.host !== `127.0.0.1:${addressPort()}` ||
      req.method !== 'GET' ||
      req.url !== `/${options.token}/json/version`
    ) {
      res.writeHead(403).end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ Browser: 'Chrome/OrcaRelay', webSocketDebuggerUrl: endpoint }))
  })
  server.maxConnections = 32
  server.headersTimeout = 5000
  server.on('upgrade', (req, socket, head) => {
    if (
      req.headers.origin ||
      req.headers.host !== `127.0.0.1:${addressPort()}` ||
      req.url !== `/${options.token}` ||
      clients.size >= 8
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    const deadline = setTimeout(() => socket.destroy(), 15_000)
    socket.once('close', () => clearTimeout(deadline))
    void options
      .ticket()
      .then((url) => {
        if (socket.destroyed) {
          return
        }
        if (new URL(url).protocol !== 'wss:') {
          throw new Error('A secure controller CDP endpoint is required')
        }
        clearTimeout(deadline)
        wss.handleUpgrade(req, socket, head, (local) => {
          clients.add(local)
          const remote = new WebSocket(url, {
            handshakeTimeout: 15000,
            maxPayload: 16 * 1024 * 1024,
            followRedirects: false
          })
          let closed = false
          const close = () => {
            if (closed) {
              return
            }
            closed = true
            clients.delete(local)
            local.terminate()
            remote.terminate()
          }
          local.on('error', close).on('close', close)
          remote.on('error', close).on('close', close)
          local.pause()
          remote.on('open', () => {
            for (const [from, to] of [
              [local, remote],
              [remote, local]
            ]) {
              from.on('message', (data, binary) => {
                if (
                  closed ||
                  to.readyState !== WebSocket.OPEN ||
                  to.bufferedAmount > 16 * 1024 * 1024
                ) {
                  close()
                  return
                }
                from.pause()
                to.send(data, { binary }, (error) => {
                  if (error) {
                    close()
                  } else if (!closed) {
                    from.resume()
                  }
                })
              })
            }
            local.resume()
          })
        })
      })
      .catch(() => socket.destroy())
  })
  function addressPort() {
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('CDP proxy is not listening')
    }
    return address.port
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  endpoint = `ws://127.0.0.1:${addressPort()}/${options.token}`
  return {
    endpoint,
    close: () => {
      for (const client of clients) {
        client.terminate()
      }
      wss.close()
      server.close()
    }
  }
}
