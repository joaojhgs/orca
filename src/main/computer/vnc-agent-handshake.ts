import { createCipheriv } from 'node:crypto'
import type { VncAgentReader } from './vnc-agent-reader'

export const VNC_AGENT_MAX_PIXELS = 4 * 1024 * 1024

export function vncAuthenticationResponse(password: string, challenge: Buffer): Buffer {
  const key = Buffer.alloc(8)
  Buffer.from(password, 'latin1').copy(key, 0, 0, 8)
  for (let index = 0; index < key.length; index++) {
    let reverse = 0
    for (let bit = 0; bit < 8; bit++) {
      reverse = (reverse << 1) | ((key[index] >> bit) & 1)
    }
    key[index] = reverse
  }
  const cipher = createCipheriv('des-ede3', Buffer.concat([key, key, key]), null)
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(challenge), cipher.final()])
}

export async function initializeVncAgent(reader: VncAgentReader, password?: string) {
  const banner = (await reader.read(12)).toString('ascii')
  if (!/^RFB 003\.\d{3}\n$/.test(banner)) {
    throw new Error('Invalid VNC protocol banner')
  }
  const minor = Number(banner.slice(8, 11))
  const version = minor >= 8 ? 8 : minor >= 7 ? 7 : 3
  await reader.write(Buffer.from(`RFB 003.00${version}\n`))
  let security: number
  if (version === 3) {
    security = (await reader.read(4)).readUInt32BE()
  } else {
    const count = (await reader.read(1))[0]
    if (!count) {
      throw new Error('VNC server rejected the connection')
    }
    const offered = await reader.read(count)
    security = password && offered.includes(2) ? 2 : offered.includes(1) ? 1 : 0
    if (!security) {
      throw new Error('Unsupported VNC authentication')
    }
    await reader.write(Buffer.from([security]))
  }
  if (security === 2) {
    if (!password) {
      throw new Error('VNC password is not configured on its owning host')
    }
    await reader.write(vncAuthenticationResponse(password, await reader.read(16)))
  } else if (security !== 1) {
    throw new Error('Unsupported VNC authentication')
  }
  if (security === 2 || version === 8) {
    if ((await reader.read(4)).readUInt32BE() !== 0) {
      throw new Error('VNC authentication rejected')
    }
  }
  // Shared connections never evict the user's browser or another viewer.
  await reader.write(Buffer.from([1]))
  const init = await reader.read(24)
  const width = init.readUInt16BE(0),
    height = init.readUInt16BE(2)
  const nameLength = init.readUInt32BE(20)
  if (!width || !height || width * height > VNC_AGENT_MAX_PIXELS || nameLength > 4096) {
    throw new Error('VNC desktop exceeds the capture limit')
  }
  await reader.read(nameLength)
  const format = Buffer.alloc(20)
  format[4] = 32
  format[5] = 24
  format[7] = 1
  format.writeUInt16BE(255, 8)
  format.writeUInt16BE(255, 10)
  format.writeUInt16BE(255, 12)
  format[14] = 16
  format[15] = 8
  await reader.write(format)
  await reader.write(Buffer.from([2, 0, 0, 1, 0, 0, 0, 0]))
  return { width, height }
}
