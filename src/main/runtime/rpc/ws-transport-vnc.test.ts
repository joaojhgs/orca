import { once } from 'node:events'
import { createServer, Socket, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
  mintDesktopVncTicket,
  resetDesktopVncTicketsForTest
} from '../../computer/desktop-vnc-tickets'
import { WebSocketTransport } from './ws-transport'

describe('WebSocketTransport VNC upgrade integration', () => {
  let transport: WebSocketTransport | undefined
  let server: Server | undefined
  const sockets: Socket[] = []

  afterEach(async () => {
    await transport?.stop()
    sockets.forEach((socket) => socket.destroy())
    sockets.length = 0
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()))
      })
    }
    resetDesktopVncTicketsForTest()
  })

  it('routes ticketed VNC and ordinary RPC separately and closes both on stop', async () => {
    server = createServer((socket) => sockets.push(socket))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP listener')
    }
    const ticket = mintDesktopVncTicket({ id: 'test-game', port: address.port, viewOnly: true })
    const targetConnected = once(server, 'connection')
    transport = new WebSocketTransport({ host: '127.0.0.1', port: 0 })
    transport.onMessage((message, reply) => reply(`rpc:${message}`))
    await transport.start()
    const base = `ws://127.0.0.1:${transport.resolvedPort}`
    const rpc = new WebSocket(base)
    await once(rpc, 'open')
    const reply = once(rpc, 'message')
    rpc.send('hello')
    expect((await reply)[0].toString()).toBe('rpc:hello')

    const vnc = new WebSocket(`${base}/desktop-vnc?ticket=${ticket}`)
    await once(vnc, 'open')
    const [target] = await targetConnected
    if (!(target instanceof Socket)) {
      throw new Error('Expected a VNC socket')
    }
    const request = once(target, 'data')
    vnc.send(Buffer.from([1, 2, 3]))
    expect((await request)[0]).toEqual(Buffer.from([1, 2, 3]))
    const frame = once(vnc, 'message')
    target.write(Buffer.from([4, 5, 6]))
    expect((await frame)[0]).toEqual(Buffer.from([4, 5, 6]))

    const rpcClosed = once(rpc, 'close')
    const vncClosed = once(vnc, 'close')
    await transport.stop()
    await Promise.all([rpcClosed, vncClosed])
  })

  it('does not allow an unauthenticated VNC upgrade through the RPC listener', async () => {
    transport = new WebSocketTransport({ host: '127.0.0.1', port: 0 })
    await transport.start()
    const ws = new WebSocket(`ws://127.0.0.1:${transport.resolvedPort}/desktop-vnc`)
    const [error] = await once(ws, 'error')
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('Unexpected server response: 401')
  })
})
