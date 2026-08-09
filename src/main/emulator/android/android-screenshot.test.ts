import { describe, expect, it } from 'vitest'
import { extractPngFromAdbOutput } from './android-screenshot'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

describe('extractPngFromAdbOutput', () => {
  it('keeps a clean screencap payload intact', () => {
    expect(extractPngFromAdbOutput(PNG)).toEqual(PNG)
  })

  it('removes Waydroid vendor warnings before the PNG signature', () => {
    const output = Buffer.concat([
      Buffer.from('/vendor/etc/hwdata/amdgpu.ids: No such file or directory\n'),
      PNG
    ])

    expect(extractPngFromAdbOutput(output)).toEqual(PNG)
  })

  it('rejects output without a PNG payload', () => {
    expect(() => extractPngFromAdbOutput(Buffer.from('adb failure'))).toThrow(
      'did not contain a PNG image'
    )
  })
})
