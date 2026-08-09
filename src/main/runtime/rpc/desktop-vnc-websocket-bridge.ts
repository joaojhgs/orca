import type { IncomingMessage } from 'node:http'
import { connect, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { consumeDesktopVncTicket } from '../../computer/desktop-vnc-tickets'

const DESKTOP_VNC_PATH = '/desktop-vnc'
const DESKTOP_VNC_PORT = 5900
const MAX_VNC_MESSAGE_BYTES = 16 * 1024 * 1024

export class DesktopVncWebSocketBridge {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_VNC_MESSAGE_BYTES })
  private readonly sockets = new Set<Socket>()

  tryUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== DESKTOP_VNC_PATH) {
      return false
    }
    const ticket = url.searchParams.get('ticket') ?? ''
    if (!consumeDesktopVncTicket(ticket)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return true
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => this.handleConnection(ws))
    return true
  }

  stop(): void {
    for (const client of this.wss.clients) {
      client.terminate()
    }
    this.wss.close()
    for (const socket of this.sockets) {
      socket.destroy()
    }
    this.sockets.clear()
  }

  private handleConnection(ws: WebSocket): void {
    const socket = connect(DESKTOP_VNC_PORT, '127.0.0.1')
    this.sockets.add(socket)
    const close = (): void => {
      this.sockets.delete(socket)
      socket.destroy()
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
        ws.terminate()
      }
    }
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        ws.close(1003, 'Binary RFB frames required')
        return
      }
      socket.write(data as Buffer)
    })
    ws.once('close', close)
    ws.once('error', close)
    socket.on('data', (data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(data, { binary: true })
      }
    })
    socket.once('error', close)
    socket.once('close', close)
  }
}
