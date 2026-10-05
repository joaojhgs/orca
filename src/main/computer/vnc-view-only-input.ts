// Client-side noVNC viewOnly is UX, not authorization. Filter the RFB byte stream too.
export class VncViewOnlyInput {
  private pending = Buffer.alloc(0)
  private phase: 'version' | 'security' | 'auth' | 'init' | 'messages' = 'version'

  accept(bytes: Buffer): Buffer[] {
    if (this.pending.length + bytes.length > 256 * 1024) {
      throw new Error('VNC input limit exceeded')
    }
    this.pending = Buffer.concat([this.pending, bytes])
    const accepted: Buffer[] = []
    while (this.pending.length > 0) {
      const length = this.nextLength()
      if (length === null || this.pending.length < length) {
        break
      }
      const frame = this.pending.subarray(0, length)
      this.pending = this.pending.subarray(length)
      if (this.phase === 'version') {
        if (!/^RFB 003\.00[78]\n$/.test(frame.toString('ascii'))) {
          throw new Error('Unsupported view-only VNC version')
        }
        this.phase = 'security'
      } else if (this.phase === 'security') {
        if (frame[0] !== 1 && frame[0] !== 2) {
          throw new Error('Unsupported view-only VNC authentication')
        }
        this.phase = frame[0] === 2 ? 'auth' : 'init'
      } else if (this.phase === 'auth') {
        this.phase = 'init'
      } else if (this.phase === 'init') {
        this.phase = 'messages'
      }
      if (this.phase === 'messages' && frame[0] === 2 && frame.length >= 4) {
        const encodings: Buffer[] = []
        for (let offset = 4; offset < frame.length; offset += 4) {
          if (frame.readUInt32BE(offset) !== 0xc0a1e5ce) {
            encodings.push(frame.subarray(offset, offset + 4))
          }
        }
        const header = Buffer.from([2, 0, 0, 0])
        header.writeUInt16BE(encodings.length, 2)
        accepted.push(Buffer.concat([header, ...encodings]))
      } else {
        accepted.push(frame)
      }
    }
    return accepted
  }

  private nextLength(): number | null {
    if (this.phase === 'version') {
      return 12
    }
    if (this.phase === 'security' || this.phase === 'init') {
      return 1
    }
    if (this.phase === 'auth') {
      return 16
    }
    const type = this.pending[0]
    if (type === 0) {
      return 20
    } // pixel format
    if (type === 3 || type === 150) {
      return 10
    } // framebuffer request / continuous updates
    if (type === 2) {
      if (this.pending.length < 4) {
        return null
      }
      const count = this.pending.readUInt16BE(2)
      if (count > 4096) {
        throw new Error('Too many VNC encodings')
      }
      return 4 + count * 4
    }
    if (type === 248) {
      if (this.pending.length < 9) {
        return null
      }
      if (this.pending[8] > 64) {
        throw new Error('Invalid VNC fence')
      }
      return 9 + this.pending[8]
    }
    throw new Error('Input is disabled for this desktop')
  }
}
