import { Duplex } from 'node:stream'
import type { BrowserNetworkTunnelSocket } from '../browser/network/tunnels/browser-network-tunnel-stream-state'

/** Keep the SSH transport's flow control when adapting to HTTP/WebSocket clients. */
export class CdpRouteSocket extends Duplex {
  constructor(private readonly socket: BrowserNetworkTunnelSocket) {
    super()
    socket.on('connect', () => this.emit('connect'))
    socket.on('data', (bytes) => {
      if (!this.push(Buffer.from(bytes))) {
        socket.pause()
      }
    })
    socket.on('end', () => this.push(null))
    socket.on('error', (error) => this.destroy(error))
    socket.on('close', () => this.destroy())
  }
  override _read() {
    this.socket.resume()
  }
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ) {
    this.socket.write(chunk, callback)
  }
  override _final(callback: (error?: Error | null) => void) {
    this.socket.end()
    callback()
  }
  override _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    this.socket.destroy()
    callback(error)
  }
}
