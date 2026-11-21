import { describe, expect, it } from 'vitest'
import { VncViewOnlyInput } from './vnc-view-only-input'

function connected(security = 1) {
  const filter = new VncViewOnlyInput()
  filter.accept(Buffer.from('RFB 003.008\n'))
  filter.accept(Buffer.from([security]))
  if (security === 2) {
    filter.accept(Buffer.alloc(16))
  }
  filter.accept(Buffer.from([1]))
  return filter
}
describe('server-enforced view-only VNC', () => {
  it('allows fragmented authentication and framebuffer negotiation', () => {
    const filter = new VncViewOnlyInput()
    expect(filter.accept(Buffer.from('RFB 003.'))).toEqual([])
    expect(filter.accept(Buffer.from('008\n\x02'))).toHaveLength(2)
    expect(filter.accept(Buffer.alloc(16))).toHaveLength(1)
    filter.accept(Buffer.from([1]))
    const messages = Buffer.concat([
      Buffer.alloc(20),
      Buffer.from([2, 0, 0, 1, 0, 0, 0, 0]),
      Buffer.from([3, 0, 0, 0, 0, 0, 0, 1, 0, 1])
    ])
    expect(filter.accept(messages)).toHaveLength(3)
  })
  it.each([4, 5, 6, 250, 251, 255])('rejects input/clipboard/power/resize opcode %i', (opcode) => {
    expect(() => connected(2).accept(Buffer.from([opcode]))).toThrow(/disabled/)
  })
  it('fails closed on unsupported authentication and input floods', () => {
    const filter = new VncViewOnlyInput()
    filter.accept(Buffer.from('RFB 003.008\n'))
    expect(() => filter.accept(Buffer.from([19]))).toThrow(/authentication/)
    expect(() => connected().accept(Buffer.alloc(256 * 1024 + 1))).toThrow(/limit/)
  })
})
