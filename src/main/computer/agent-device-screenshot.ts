import { PNG } from 'pngjs'

const MAX_AGENT_BASE64 = 512 * 1024
const MAX_PIXELS = 4 * 1024 * 1024

export function encodeAgentDeviceScreenshot(source: PNG) {
  if (!source.width || !source.height || source.width * source.height > MAX_PIXELS) {
    throw new Error('Device screenshot exceeds the capture limit')
  }
  let scale = Math.min(1, 1280 / source.width, 1280 / source.height)
  for (let attempt = 0; attempt < 12; attempt++) {
    const width = Math.max(1, Math.floor(source.width * scale))
    const height = Math.max(1, Math.floor(source.height * scale))
    const image = new PNG({ width, height })
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sourcePixel =
          (Math.floor((y * source.height) / height) * source.width +
            Math.floor((x * source.width) / width)) *
          4
        source.data.copy(image.data, (y * width + x) * 4, sourcePixel, sourcePixel + 4)
      }
    }
    const pngBase64 = PNG.sync.write(image).toString('base64')
    if (pngBase64.length <= MAX_AGENT_BASE64) {
      return {
        pngBase64,
        imageWidth: width,
        imageHeight: height,
        width: source.width,
        height: source.height
      }
    }
    scale *= 0.75
  }
  throw new Error('Device screenshot exceeds the SSH response limit')
}

export function compactAgentDeviceScreenshot(pngBase64: string) {
  const bytes = Buffer.from(pngBase64, 'base64')
  if (
    bytes.length < 24 ||
    bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a' ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('Invalid device screenshot')
  }
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20)
  if (!width || !height || width * height > MAX_PIXELS || bytes.length > 3 * 1024 * 1024) {
    throw new Error('Device screenshot exceeds the capture limit')
  }
  return encodeAgentDeviceScreenshot(PNG.sync.read(bytes))
}
