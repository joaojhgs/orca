import type { BrowserNetworkTunnelSocket } from '../browser/browser-network-tunnel-stream-state'

const MAX_BUFFER_BYTES = 20 * 1024 * 1024

export class VncAgentReader {
  private chunks: Buffer[] = []
  private pendingBytes = 0
  private wake: (() => void) | undefined
  private failure: Error | undefined
  private readonly failedWrites = new Set<(error: Error) => void>()

  constructor(private readonly socket: BrowserNetworkTunnelSocket) {
    socket.on('data', (bytes) => {
      if (this.pendingBytes + bytes.length > MAX_BUFFER_BYTES || this.chunks.length >= 8192) {
        this.fail(new Error('VNC response exceeds the capture limit'))
        socket.destroy()
        return
      }
      if (bytes.length) {
        this.chunks.push(Buffer.from(bytes))
      }
      this.pendingBytes += bytes.length
      this.wake?.()
    })
    socket.on('error', () => this.fail(new Error('VNC connection is unverifiable')))
    socket.on('end', () => this.fail(new Error('VNC connection closed')))
    socket.on('close', () => this.fail(new Error('VNC connection closed')))
    if (socket.destroyed) {
      this.fail(new Error('VNC connection closed'))
    }
  }

  fail(error: Error): void {
    this.failure ??= error
    this.wake?.()
    for (const reject of this.failedWrites) {
      reject(this.failure)
    }
    this.failedWrites.clear()
  }

  async read(length: number): Promise<Buffer> {
    if (!Number.isInteger(length) || length < 0 || length > MAX_BUFFER_BYTES) {
      throw new Error('Invalid VNC response size')
    }
    while (this.pendingBytes < length) {
      if (this.failure) {
        throw this.failure
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
      this.wake = undefined
    }
    if (this.failure) {
      throw this.failure
    }
    const bytes = Buffer.allocUnsafe(length)
    let written = 0
    while (written < length) {
      const chunk = this.chunks[0]
      const count = Math.min(chunk.length, length - written)
      chunk.copy(bytes, written, 0, count)
      if (count === chunk.length) {
        this.chunks.shift()
      } else {
        this.chunks[0] = chunk.subarray(count)
      }
      written += count
    }
    this.pendingBytes -= length
    return bytes
  }

  write(bytes: Buffer): Promise<void> {
    if (this.failure) {
      return Promise.reject(this.failure)
    }
    return new Promise<void>((resolve, reject) => {
      this.failedWrites.add(reject)
      this.socket.write(bytes, () => {
        this.failedWrites.delete(reject)
        resolve()
      })
    })
  }
}
