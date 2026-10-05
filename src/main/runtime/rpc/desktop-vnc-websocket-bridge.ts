import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  consumeDesktopVncTicketTarget,
  type DesktopVncTicketTarget
} from '../../computer/desktop-vnc-tickets'
import {
  isDesktopVncTicketCurrent,
  openDesktopVncRoute
} from '../../computer/ssh-desktop-vnc-route'
import { VncViewOnlyInput } from '../../computer/vnc-view-only-input'

const DESKTOP_VNC_PATH = '/desktop-vnc'
const MAX_VNC_MESSAGE_BYTES = 16 * 1024 * 1024

export class DesktopVncWebSocketBridge {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_VNC_MESSAGE_BYTES })
  private readonly connections = new Set<() => void>()
  private stopped = false

  tryUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== DESKTOP_VNC_PATH) {
      return false
    }
    const ticket = url.searchParams.get('ticket') ?? ''
    const target = consumeDesktopVncTicketTarget(ticket)
    if (
      !target ||
      this.stopped ||
      this.wss.clients.size >= 16 ||
      !isDesktopVncTicketCurrent(target)
    ) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return true
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => this.handleConnection(ws, target))
    return true
  }

  stop(): void {
    this.stopped = true
    for (const close of this.connections) {
      close()
    }
    for (const client of this.wss.clients) {
      client.terminate()
    }
    this.wss.close()
    this.connections.clear()
  }

  private handleConnection(ws: WebSocket, target: DesktopVncTicketTarget): void {
    let channel: Awaited<ReturnType<typeof openDesktopVncRoute>> | undefined
    let closed = false
    let connected = false
    let queuedBytes = 0
    let pendingWrites = 0
    const queued: Buffer[] = []
    const viewOnly = target.ssh && target.viewOnly ? new VncViewOnlyInput() : null
    const abort = new AbortController()
    const timeout = setTimeout(() => close(), 10_000)
    const policyCheck = target.ssh
      ? setInterval(() => {
          if (!isDesktopVncTicketCurrent(target)) {
            close()
          }
        }, 2000)
      : undefined
    const close = (): void => {
      if (closed) {
        return
      }
      closed = true
      abort.abort()
      clearTimeout(timeout)
      clearInterval(policyCheck)
      queued.length = 0
      this.connections.delete(close)
      channel?.socket.destroy()
      void channel?.close()
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
        ws.terminate()
      }
    }
    this.connections.add(close)
    const write = (payload: Buffer) => {
      pendingWrites += payload.length
      if (pendingWrites > 4 * 1024 * 1024) {
        close()
        return
      }
      channel?.socket.write(payload, () => {
        pendingWrites -= payload.length
      })
    }
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        ws.close(1003, 'Binary RFB frames required')
        return
      }
      const payload = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data)
      if (closed) {
        return
      }
      try {
        const frames = viewOnly ? viewOnly.accept(payload) : [payload]
        for (const frame of frames) {
          if (connected) {
            write(frame)
          } else {
            queuedBytes += frame.length
            if (queuedBytes > 256 * 1024 || queued.length >= 256) {
              close()
              return
            }
            queued.push(frame)
          }
        }
      } catch {
        ws.close(1008, 'Desktop input is not permitted')
        close()
      }
    })
    ws.once('close', close)
    ws.once('error', close)
    void openDesktopVncRoute(target, abort.signal)
      .then((opened) => {
        channel = opened
        if (closed || opened.socket.destroyed || !isDesktopVncTicketCurrent(target)) {
          opened.socket.destroy()
          void opened.close()
          close()
          return
        }
        opened.socket.on('error', close).on('close', close).on('end', close)
        opened.socket.on('connect', () => {
          connected = true
          clearTimeout(timeout)
          for (const payload of queued) {
            write(payload)
          }
          queued.length = 0
        })
        opened.socket.on('data', (data) => {
          if (closed || ws.readyState !== ws.OPEN) {
            return
          }
          if (ws.bufferedAmount + data.byteLength > MAX_VNC_MESSAGE_BYTES) {
            close()
            return
          }
          opened.socket.pause()
          ws.send(data, { binary: true }, (error) => {
            if (error) {
              close()
            } else if (!closed) {
              opened.socket.resume()
            }
          })
        })
        void opened.whenInvalidated?.then(close)
      })
      .catch(close)
  }
}
