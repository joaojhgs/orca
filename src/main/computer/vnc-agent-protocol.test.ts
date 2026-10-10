import { createConnection, createServer, type Socket } from 'node:net'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { initializeVncAgent, vncAuthenticationResponse } from './vnc-agent-handshake'
import { captureVncAgentFramebuffer } from './vnc-agent-framebuffer'
import { VncAgentReader } from './vnc-agent-reader'
import { vncAgentInputFrames } from './vnc-agent-input'
import { VncAgentAction } from '../../shared/vnc-agent-contract'

async function withRfbServer(
  version: number,
  password: string | undefined,
  run: (reader: VncAgentReader) => Promise<void>,
  invalidRect = false
) {
  const clients = new Set<Socket>()
  const server = createServer((socket) => {
    clients.add(socket)
    const challenge = Buffer.alloc(16, 0x5a)
    let pending = Buffer.alloc(0),
      phase = 'version'
    socket.on('error', () => {})
    socket.write(`RFB 003.00${version}\n`)
    socket.on('data', (data) => {
      pending = Buffer.concat([pending, data])
      for (;;) {
        const length =
          phase === 'version'
            ? 12
            : phase === 'security'
              ? 1
              : phase === 'auth'
                ? 16
                : phase === 'init'
                  ? 1
                  : pending[0] === 0
                    ? 20
                    : pending[0] === 2
                      ? 8
                      : 10
        if (pending.length < length) {
          break
        }
        const message = pending.subarray(0, length)
        pending = pending.subarray(length)
        if (phase === 'version') {
          if (version === 3) {
            socket.write(Buffer.from([0, 0, 0, password ? 2 : 1]))
            phase = password ? 'auth' : 'init'
            if (password) {
              socket.write(challenge)
            }
          } else {
            socket.write(Buffer.from([1, password ? 2 : 1]))
            phase = 'security'
          }
        } else if (phase === 'security') {
          phase = password ? 'auth' : 'init'
          if (password) {
            socket.write(challenge)
          } else if (version === 8) {
            socket.write(Buffer.alloc(4))
          }
        } else if (phase === 'auth') {
          expect(message).toEqual(vncAuthenticationResponse(password ?? '', challenge))
          socket.write(Buffer.alloc(4))
          phase = 'init'
        } else if (phase === 'init') {
          expect(message[0]).toBe(1)
          const init = Buffer.alloc(24)
          init.writeUInt16BE(2, 0)
          init.writeUInt16BE(1, 2)
          socket.write(init.subarray(0, 7))
          socket.write(init.subarray(7))
          phase = 'messages'
        } else if (message[0] === 3) {
          const rect = Buffer.alloc(12)
          rect.writeUInt16BE(invalidRect ? 3 : 2, 4)
          rect.writeUInt16BE(1, 6)
          socket.write(
            Buffer.concat([
              Buffer.from([2, 0, 0, 0, 1]),
              rect,
              Buffer.from([0, 0, 255, 0, 0, 255, 0, 0])
            ])
          )
        }
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Missing server port')
  }
  const socket = createConnection(address.port, '127.0.0.1')
  try {
    await run(new VncAgentReader(socket))
  } finally {
    socket.destroy()
    for (const client of clients) {
      client.destroy()
    }
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('bounded VNC agent protocol', () => {
  for (const version of [3, 7, 8]) {
    for (const password of [undefined, 'test-only']) {
      it(`captures fragmented RFB 3.${version} with ${password ? 'password' : 'no password'} authentication`, async () => {
        await withRfbServer(version, password, async (reader) => {
          expect(await initializeVncAgent(reader, password)).toEqual({ width: 2, height: 1 })
          const png = PNG.sync.read(
            Buffer.from(await captureVncAgentFramebuffer(reader, 2, 1), 'base64')
          )
          expect([...png.data]).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
        })
      })
    }
  }
  it('refuses rectangles outside the observed framebuffer', async () => {
    await withRfbServer(
      8,
      undefined,
      async (reader) => {
        await initializeVncAgent(reader)
        await expect(captureVncAgentFramebuffer(reader, 2, 1)).rejects.toThrow(/rectangle/)
      },
      true
    )
  })
  it('validates every input coordinate before emitting bytes', () => {
    expect(() =>
      vncAgentInputFrames({ kind: 'drag', x: 1, y: 1, toX: 20, toY: 2 }, 10, 10)
    ).toThrow(/outside/)
    const click = vncAgentInputFrames(
      { kind: 'click', x: 4, y: 5, button: 'right', count: 1 },
      10,
      10
    )
    expect(click).toEqual([Buffer.from([5, 4, 0, 4, 0, 5]), Buffer.from([5, 0, 0, 4, 0, 5])])
  })
  it('releases all key modifiers in the same bounded input frame', () => {
    const frames = vncAgentInputFrames({ kind: 'key', key: 'Ctrl+Shift+A' }, 10, 10)
    expect(frames.map((frame) => frame[1])).toEqual([1, 1, 1, 0, 0, 0])
    expect(frames[0].readUInt32BE(4)).toBe(frames[5].readUInt32BE(4))
    expect(() => vncAgentInputFrames({ kind: 'key', key: 'badkey' }, 10, 10)).toThrow(/Unknown/)
  })
  it('rejects nonfinite, fractional, negative, oversized and unrelated input', () => {
    for (const x of [-1, 0.1, Number.NaN, Infinity, 65536]) {
      expect(VncAgentAction.safeParse({ kind: 'move', x, y: 0 }).success).toBe(false)
    }
    expect(VncAgentAction.safeParse({ kind: 'key', key: 'A', host: 'unapproved' }).success).toBe(
      false
    )
  })
})
