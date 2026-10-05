import { createServer, type Server as HttpServer } from 'node:http'
import { createServer as createTcpServer, type Server as TcpServer, Socket } from 'node:net'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
  mintDesktopVncTicket,
  resetDesktopVncTicketsForTest
} from '../../computer/desktop-vnc-tickets'
import { DesktopVncWebSocketBridge } from './desktop-vnc-websocket-bridge'

describe('DesktopVncWebSocketBridge', () => {
  let httpServer: HttpServer | null = null
  let tcpServer: TcpServer | null = null
  let bridge: DesktopVncWebSocketBridge | null = null

  afterEach(async () => {
    bridge?.stop()
    bridge = null
    await closeServer(httpServer)
    await closeServer(tcpServer)
    httpServer = null
    tcpServer = null
    resetDesktopVncTicketsForTest()
  })

  it('connects a valid ticket to the ticket-bound target port', async () => {
    tcpServer = createTcpServer()
    tcpServer.listen(0, '127.0.0.1')
    await once(tcpServer, 'listening')
    const targetPort = serverPort(tcpServer)
    const ticket = mintDesktopVncTicket({ id: 'game', port: targetPort, viewOnly: true })
    const connectionPromise = once(tcpServer, 'connection')

    bridge = new DesktopVncWebSocketBridge()
    httpServer = createBridgeServer(bridge)
    httpServer.listen(0, '127.0.0.1')
    await once(httpServer, 'listening')
    const ws = new WebSocket(
      `ws://127.0.0.1:${serverPort(httpServer)}/desktop-vnc?ticket=${ticket}&port=5900&desktopId=main`
    )
    await once(ws, 'open')
    const [targetSocket] = await connectionPromise
    if (!(targetSocket instanceof Socket)) {
      throw new Error('Expected a connected TCP socket')
    }
    const targetMessage = once(targetSocket, 'data')
    const websocketMessage = once(ws, 'message')

    ws.send(Buffer.from([4, 5, 6]))
    expect((await targetMessage)[0]).toEqual(Buffer.from([4, 5, 6]))

    targetSocket.write(Buffer.from([1, 2, 3]))
    expect((await websocketMessage)[0]).toEqual(Buffer.from([1, 2, 3]))
    ws.close()
  })

  it('rejects reused tickets before connecting to VNC', async () => {
    bridge = new DesktopVncWebSocketBridge()
    httpServer = createBridgeServer(bridge)
    httpServer.listen(0, '127.0.0.1')
    await once(httpServer, 'listening')
    const ticket = mintDesktopVncTicket({ id: 'game', port: 65_534, viewOnly: true })
    const port = serverPort(httpServer)

    const first = new WebSocket(`ws://127.0.0.1:${port}/desktop-vnc?ticket=${ticket}`)
    await once(first, 'open')
    first.terminate()

    const second = new WebSocket(`ws://127.0.0.1:${port}/desktop-vnc?ticket=${ticket}`)
    const [error] = await once(second, 'error')
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('Unexpected server response: 401')
  })
})

function serverPort(server: HttpServer | TcpServer): number {
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Expected a listening TCP server')
  }
  return address.port
}

function createBridgeServer(bridge: DesktopVncWebSocketBridge): HttpServer {
  const server = createServer()
  server.on('upgrade', (request, socket, head) => {
    if (!bridge.tryUpgrade(request, socket, head)) {
      socket.destroy()
    }
  })
  return server
}

async function closeServer(server: HttpServer | TcpServer | null): Promise<void> {
  if (!server?.listening) {
    return
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}
