import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { WebSocket } from 'ws'
import { WebSocketServer } from 'ws'
import {
  NETWORK_FORWARD_MAX_BUFFER,
  NETWORK_FORWARD_PATH
} from '../../../shared/network-forward-contract'
import {
  agentForwardIsCurrent,
  consumeAgentForwardTicket,
  openAgentForward,
  type AgentForwardTarget
} from '../../ports/agent-forward-access'
import type { BrowserNetworkTunnelSocket } from '../../browser/network/tunnels/browser-network-tunnel-stream-state'

export class AgentForwardWebSocketBridge {
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: NETWORK_FORWARD_MAX_BUFFER
  })
  private readonly connections = new Set<() => void>()
  private stopped = false

  tryUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== NETWORK_FORWARD_PATH) {
      return false
    }
    // Browser-origin traffic is not an agent-owned TCP tunnel.
    const target = request.headers.origin
      ? null
      : consumeAgentForwardTicket(url.searchParams.get('ticket') ?? '')
    if (!target || this.stopped || this.connections.size >= 32) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      return true
    }
    this.wss.handleUpgrade(request, socket, head, (client) => this.connect(client, target))
    return true
  }

  private connect(client: WebSocket, target: AgentForwardTarget) {
    let route: Awaited<ReturnType<typeof openAgentForward>> | undefined
    let upstream: BrowserNetworkTunnelSocket | undefined
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
      this.connections.delete(close)
      upstream?.destroy()
      client.terminate()
      void route?.close()
    }
    const check = setInterval(() => {
      if (!agentForwardIsCurrent(target)) {
        close()
      }
    }, 2000)
    const deadline = setTimeout(close, 15000)
    this.connections.add(close)
    client.on('error', close).on('close', close)
    client.pause()
    void openAgentForward(target, abort.signal)
      .then((opened) => {
        route = opened
        if (closed || !opened.isValid() || !agentForwardIsCurrent(target)) {
          close()
          void opened.close()
          return
        }
        upstream = opened.connect({ host: target.host, port: target.port })
        upstream.on('error', close).on('close', () => {
          if (!closed) {
            client.close()
          }
        })
        upstream.on('connect', () => {
          if (closed) {
            return
          }
          clearTimeout(deadline)
          client.send(JSON.stringify({ type: 'ready', routeId: target.id }))
          client.resume()
        })
        upstream.on('data', (data) => {
          if (closed || client.bufferedAmount > NETWORK_FORWARD_MAX_BUFFER) {
            close()
            return
          }
          upstream?.pause()
          client.send(data, { binary: true }, (error) => {
            if (error) {
              close()
            } else {
              upstream?.resume()
            }
          })
        })
        upstream.on('end', () => {
          if (!closed) {
            client.send('{"type":"end"}')
          }
        })
        client.on('message', (data, binary) => {
          if (closed || !upstream) {
            return
          }
          if (!binary) {
            if (data.toString() === '{"type":"end"}') {
              upstream.end()
            } else {
              close()
            }
            return
          }
          client.pause()
          const bytes = Array.isArray(data)
            ? Buffer.concat(data)
            : data instanceof ArrayBuffer
              ? Buffer.from(data)
              : data
          upstream.write(bytes, () => {
            if (!closed) {
              client.resume()
            }
          })
        })
        void opened.whenInvalidated?.then(close)
      })
      .catch(close)
  }

  stop() {
    this.stopped = true
    for (const close of this.connections) {
      close()
    }
    this.wss.close()
  }
}
