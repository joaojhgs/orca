import { PNG } from 'pngjs'
import type { VncAgentReader } from './vnc-agent-reader'
import { encodeAgentDeviceScreenshot } from './agent-device-screenshot'

export async function captureVncAgentFramebuffer(
  reader: VncAgentReader,
  width: number,
  height: number
) {
  const request = Buffer.alloc(10)
  request[0] = 3
  request.writeUInt16BE(width, 6)
  request.writeUInt16BE(height, 8)
  await reader.write(request)
  const png = new PNG({ width, height })
  const covered = new Uint8Array(width * height)
  let pixels = 0,
    totalBytes = 0
  for (let message = 0; message < 64; message++) {
    const kind = (await reader.read(1))[0]
    if (kind === 2) {
      continue
    }
    if (kind === 3) {
      const header = await reader.read(7)
      const length = header.readUInt32BE(3)
      if (length > 65536) {
        throw new Error('VNC clipboard exceeds the capture limit')
      }
      await reader.read(length)
      continue
    }
    if (kind !== 0) {
      throw new Error('Unsupported VNC server message')
    }
    const count = (await reader.read(3)).readUInt16BE(1)
    if (!count || count > 4096) {
      throw new Error('Invalid VNC framebuffer update')
    }
    for (let rectangle = 0; rectangle < count; rectangle++) {
      const rect = await reader.read(12)
      const x = rect.readUInt16BE(0),
        y = rect.readUInt16BE(2)
      const w = rect.readUInt16BE(4),
        h = rect.readUInt16BE(6)
      if (rect.readInt32BE(8) !== 0 || !w || !h || x + w > width || y + h > height) {
        throw new Error('Unsupported or invalid VNC framebuffer rectangle')
      }
      totalBytes += w * h * 4
      if (totalBytes > width * height * 8) {
        throw new Error('VNC framebuffer exceeds the capture limit')
      }
      const bytes = await reader.read(w * h * 4)
      for (let row = 0; row < h; row++) {
        for (let column = 0; column < w; column++) {
          const src = (row * w + column) * 4
          const pixel = (y + row) * width + x + column
          const dst = pixel * 4
          png.data[dst] = bytes[src + 2]
          png.data[dst + 1] = bytes[src + 1]
          png.data[dst + 2] = bytes[src]
          png.data[dst + 3] = 255
          if (!covered[pixel]) {
            covered[pixel] = 1
            pixels++
          }
        }
      }
    }
    if (pixels === width * height) {
      return encodeAgentDeviceScreenshot(png)
    }
  }
  throw new Error('VNC framebuffer capture is incomplete')
}
