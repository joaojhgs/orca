import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { REMOTE_RUNTIME_MAX_WEBSOCKET_FRAME_BYTES } from '../../../shared/remote-runtime/remote-runtime-memory-limits'
import { WebSocketTransport } from './transports/websocket/ws-transport'

describe('artifact payloads over the paired WebSocket transport', () => {
  const transports: WebSocketTransport[] = []
  afterEach(async () => {
    await Promise.all(transports.splice(0).map((transport) => transport.stop()))
  })

  async function connect() {
    const transport = new WebSocketTransport({ host: '127.0.0.1', port: 0 })
    const received = vi.fn()
    transport.onMessage((message, reply, socket) => {
      received(message)
      if (message === 'authenticate-test-device') {
        transport.setClientId(socket, 'paired-test-device')
      }
      reply(JSON.stringify({ bytes: Buffer.byteLength(message) }))
    })
    transports.push(transport)
    await transport.start()
    const socket = new WebSocket(`ws://127.0.0.1:${transport.resolvedPort}`)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    return { socket, received }
  }

  function exchange(socket: WebSocket, message: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const onClose = () => reject(new Error('Connection closed before RPC response'))
      socket.once('close', onClose)
      socket.once('message', (data) => {
        socket.off('close', onClose)
        resolve(data.toString())
      })
      socket.send(message)
    })
  }

  function sendUntilClosed(socket: WebSocket, message: string): Promise<number> {
    return new Promise((resolve) => {
      socket.once('close', (code) => resolve(code))
      socket.send(message)
    })
  }

  it('accepts a paired PDF publish larger than the old 1 MiB ceiling', async () => {
    const { socket, received } = await connect()
    await exchange(socket, 'authenticate-test-device')
    const content = Buffer.from(`%PDF-1.4\n${'x'.repeat(1_406_762)}`).toString('base64')
    const request = JSON.stringify({
      method: 'artifacts.publish',
      params: { sourceKey: '/report.pdf', content, contentType: 'application/pdf' }
    })

    expect(JSON.parse(await exchange(socket, request))).toEqual({
      bytes: Buffer.byteLength(request)
    })
    expect(received).toHaveBeenLastCalledWith(request)
    socket.close()
  })

  it('keeps the old 1 MiB admission limit before authentication', async () => {
    const { socket, received } = await connect()
    expect(await sendUntilClosed(socket, 'x'.repeat(1024 * 1024 + 100))).toBe(1009)
    expect(received).not.toHaveBeenCalled()
  })

  it('still rejects paired messages beyond the shared wire limit', async () => {
    const { socket, received } = await connect()
    await exchange(socket, 'authenticate-test-device')
    expect(
      await sendUntilClosed(socket, 'x'.repeat(REMOTE_RUNTIME_MAX_WEBSOCKET_FRAME_BYTES + 1))
    ).toBe(1009)
    expect(received).toHaveBeenCalledTimes(1)
  })
})
