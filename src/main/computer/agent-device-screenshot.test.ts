import { randomFillSync } from 'node:crypto'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import {
  compactAgentDeviceScreenshot,
  encodeAgentDeviceScreenshot
} from './agent-device-screenshot'

describe('agent screenshots over the existing SSH relay', () => {
  it('fits a noisy full desktop below half the relay control queue with explicit geometry', () => {
    const original = new PNG({ width: 1600, height: 900 })
    randomFillSync(original.data)
    const result = encodeAgentDeviceScreenshot(original)
    expect(result.pngBase64.length).toBeLessThanOrEqual(512 * 1024)
    expect(result).toMatchObject({ width: 1600, height: 900 })
    const decoded = PNG.sync.read(Buffer.from(result.pngBase64, 'base64'))
    expect(decoded.width).toBe(result.imageWidth)
    expect(decoded.height).toBe(result.imageHeight)
    expect(decoded.width).toBeLessThan(original.width)
    expect(Buffer.byteLength(JSON.stringify({ stdout: JSON.stringify({ result }) }))).toBeLessThan(
      600 * 1024
    )
  })
  it('keeps a small PNG at its original size', () => {
    const original = new PNG({ width: 2, height: 1 })
    original.data.fill(255)
    const result = compactAgentDeviceScreenshot(PNG.sync.write(original).toString('base64'))
    expect(result).toMatchObject({ width: 2, height: 1, imageWidth: 2, imageHeight: 1 })
  })
  it('rejects forged and decompression-bomb geometry before decoding pixel data', () => {
    expect(() => compactAgentDeviceScreenshot('invalid')).toThrow(/Invalid/)
    const header = Buffer.alloc(24)
    Buffer.from('89504e470d0a1a0a', 'hex').copy(header)
    header.write('IHDR', 12)
    header.writeUInt32BE(100000, 16)
    header.writeUInt32BE(100000, 20)
    expect(() => compactAgentDeviceScreenshot(header.toString('base64'))).toThrow(/capture limit/)
  })
})
