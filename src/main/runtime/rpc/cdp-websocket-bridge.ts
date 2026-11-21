import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { consumeCdpBrowserTicket, openCdpBrowserRoute } from '../../computer/cdp-browser-access'
import { cdpBrowserIsCurrent, cdpControlEvents } from '../../computer/cdp-browser-policy'
import { CdpRouteSocket } from '../../computer/cdp-route-socket'

export class CdpWebSocketBridge {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 })
  private readonly connections = new Set<() => void>()
  private stopped = false

  tryUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== '/browser-cdp') {
      return false
    }
    const target = consumeCdpBrowserTicket(url.searchParams.get('ticket') ?? '')
    if (!target || this.stopped || this.connections.size >= 16) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      return true
    }
    this.server.handleUpgrade(request, socket, head, (client) => {
      let upstream: WebSocket | undefined
      let route: Awaited<ReturnType<typeof openCdpBrowserRoute>> | undefined
      let closed = false
      const abort = new AbortController()
      const close = () => {
        if (closed) {
          return
        }
        closed = true
        abort.abort()
        clearInterval(check)
        clearTimeout(deadline)
        cdpControlEvents.off('change', changed)
        this.connections.delete(close)
        upstream?.terminate()
        client.terminate()
        void route?.close()
      }
      const changed = (id: string) => {
        if (id === target.browserId) {
          close()
        }
      }
      const check = setInterval(() => {
        if (!cdpBrowserIsCurrent(target)) {
          close()
        }
      }, 2000)
      const deadline = setTimeout(close, 15000)
      this.connections.add(close)
      cdpControlEvents.on('change', changed)
      client.on('error', close).on('close', close)
      // No CDP input is accepted before the target's WebSocket has completed its handshake.
      client.pause()
      void openCdpBrowserRoute(target, abort.signal)
        .then((opened) => {
          route = opened
          if (closed || !cdpBrowserIsCurrent(target)) {
            close()
            return
          }
          upstream = new WebSocket(`ws://127.0.0.1:${target.port}${target.debuggerPath}`, {
            createConnection: () =>
              new CdpRouteSocket(opened.connect({ host: '127.0.0.1', port: target.port })),
            handshakeTimeout: 12000,
            maxPayload: 16 * 1024 * 1024,
            followRedirects: false
          })
          const relay = (from: WebSocket, to: WebSocket) =>
            from.on('message', (bytes, isBinary) => {
              if (
                closed ||
                !cdpBrowserIsCurrent(target) ||
                to.readyState !== WebSocket.OPEN ||
                to.bufferedAmount > 16 * 1024 * 1024
              ) {
                close()
                return
              }
              from.pause()
              to.send(bytes, { binary: isBinary }, (error) => {
                if (error) {
                  close()
                } else if (!closed) {
                  from.resume()
                }
              })
            })
          upstream.on('error', close).on('close', close)
          upstream.on('open', () => {
            if (closed || !cdpBrowserIsCurrent(target) || !upstream) {
              close()
              return
            }
            clearTimeout(deadline)
            relay(client, upstream)
            relay(upstream, client)
            client.resume()
          })
          void opened.whenInvalidated?.then(close)
        })
        .catch(close)
    })
    return true
  }

  stop() {
    this.stopped = true
    for (const close of this.connections) {
      close()
    }
    this.server.close()
  }
}
