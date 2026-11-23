import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mintWebFilePreview, revokeWebFilePreviews, withWebFilePreviews } from './web-file-preview'

const servers: Server[] = []
afterEach(async () => {
  revokeWebFilePreviews('browser-a')
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
          server.closeAllConnections()
        })
    )
  )
})

async function fixture() {
  const bytes = Buffer.from('0123456789abcdef')
  let mtime = 1
  const source = {
    stat: async () => ({ size: bytes.length, mtime, isDirectory: false }),
    read: async (offset: number, length: number) => {
      const part = bytes.subarray(offset, offset + length)
      return { contentBase64: part.toString('base64'), bytesRead: part.length }
    }
  }
  const preview = await mintWebFilePreview('browser-a', source, 'video/webm')
  const server = createServer(
    withWebFilePreviews((_request, response) => response.writeHead(404).end())
  )
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('No test port')
  }
  const origin = `http://127.0.0.1:${address.port}`
  return {
    url: origin + preview.mediaUrl,
    origin,
    change: () => {
      mtime++
    }
  }
}

describe('browser media ranges', () => {
  it('streams seek and suffix ranges, HEAD and invalid-range responses', async () => {
    const { url } = await fixture()
    const range = await fetch(url, { headers: { Range: 'bytes=3-7' } })
    expect(range.status).toBe(206)
    expect(range.headers.get('content-range')).toBe('bytes 3-7/16')
    expect(range.headers.get('content-type')).toBe('video/webm')
    expect(await range.text()).toBe('34567')
    expect(await (await fetch(url, { headers: { Range: 'bytes=-4' } })).text()).toBe('cdef')
    const head = await fetch(url, { method: 'HEAD' })
    expect(head.headers.get('content-length')).toBe('16')
    expect(await head.text()).toBe('')
    const invalid = await fetch(url, { headers: { Range: 'bytes=100-200' } })
    expect(invalid.status).toBe(416)
    expect(invalid.headers.get('content-range')).toBe('bytes */16')
  })
  it('refuses unknown capabilities, changed files and disconnected owners', async () => {
    const { url, origin, change } = await fixture()
    expect((await fetch(`${origin}/__orca_media/unknown`)).status).toBe(404)
    change()
    expect((await fetch(url)).status).toBe(410)
    revokeWebFilePreviews('browser-a')
    expect((await fetch(url)).status).toBe(404)
  })
})
