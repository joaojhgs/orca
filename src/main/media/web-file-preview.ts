import { randomBytes } from 'node:crypto'
import type { RequestListener } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createMediaRangeResponse } from './media-range-response'

type Snapshot = { size: number; mtime: number; ctime?: number; isDirectory: boolean }
type Source = {
  stat: () => Promise<Snapshot>
  read: (offset: number, length: number) => Promise<{ contentBase64: string; bytesRead: number }>
}
type Grant = {
  owner: string
  snapshot: Snapshot
  source: Source
  mimeType: string
  expiresAt: number
  abort: AbortController
}
const grants = new Map<string, Grant>()
const PREFIX = '/__orca_media/'
const LIFETIME_MS = 8 * 60 * 60 * 1000
let activeRequests = 0

function drop(token: string): void {
  grants.get(token)?.abort.abort()
  grants.delete(token)
}
export function revokeWebFilePreviews(owner: string): void {
  for (const [token, grant] of grants) {
    if (grant.owner === owner) {
      drop(token)
    }
  }
}

export async function mintWebFilePreview(owner: string, source: Source, mimeType: string) {
  const snapshot = await source.stat()
  if (snapshot.isDirectory || !Number.isSafeInteger(snapshot.size) || snapshot.size < 0) {
    throw new Error('Not a regular media file')
  }
  for (const [token, grant] of grants) {
    if (grant.expiresAt < Date.now()) {
      drop(token)
    }
  }
  const owned = [...grants.entries()].filter(([, grant]) => grant.owner === owner)
  if (owned.length >= 64) {
    drop(owned[0]![0])
  }
  if (grants.size >= 256) {
    throw new Error('Too many media previews')
  }
  const token = randomBytes(32).toString('base64url')
  grants.set(token, {
    owner,
    snapshot,
    source,
    mimeType,
    expiresAt: Date.now() + LIFETIME_MS,
    abort: new AbortController()
  })
  return {
    content: '',
    isBinary: true as const,
    mimeType,
    mediaUrl: `${PREFIX}${token}`,
    size: snapshot.size
  }
}

function assertSnapshot(expected: Snapshot, current: Snapshot): void {
  if (
    current.isDirectory ||
    current.size !== expected.size ||
    current.mtime !== expected.mtime ||
    current.ctime !== expected.ctime
  ) {
    throw new Error('Media changed on disk; reopen the file')
  }
}

export function withWebFilePreviews(next: RequestListener): RequestListener {
  return (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (!path.startsWith(PREFIX)) {
      next(request, response)
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Range, Content-Length, Accept-Ranges'
    )
    const token = path.slice(PREFIX.length)
    const grant = grants.get(token)
    if (
      !grant ||
      grant.expiresAt < Date.now() ||
      !['GET', 'HEAD'].includes(request.method ?? '') ||
      activeRequests >= 8
    ) {
      if (grant?.expiresAt && grant.expiresAt < Date.now()) {
        drop(token)
      }
      response.writeHead(404).end()
      return
    }
    activeRequests++
    const abort = new AbortController()
    const cancel = () => abort.abort()
    response.once('close', cancel)
    grant.abort.signal.addEventListener('abort', cancel, { once: true })
    void (async () => {
      try {
        assertSnapshot(grant.snapshot, await grant.source.stat())
        const headers = new Headers()
        if (request.headers.range) {
          headers.set('range', request.headers.range)
        }
        const result = await createMediaRangeResponse(
          new Request('http://localhost/media', {
            method: request.method,
            headers,
            signal: abort.signal
          }),
          grant.mimeType,
          {
            size: grant.snapshot.size,
            read: async (offset, length) => {
              abort.signal.throwIfAborted()
              if (grants.get(token) !== grant) {
                throw new Error('Media preview revoked')
              }
              const chunk = await grant.source.read(offset, length)
              assertSnapshot(grant.snapshot, await grant.source.stat())
              const bytes = Buffer.from(chunk.contentBase64, 'base64')
              if (bytes.length !== chunk.bytesRead || bytes.length > length) {
                throw new Error('Invalid media range')
              }
              return bytes
            },
            close: async () => {}
          }
        )
        response.statusCode = result.status
        result.headers.forEach((value, key) => response.setHeader(key, value))
        if (result.body) {
          const reader = result.body.getReader()
          await pipeline(
            Readable.from(
              (async function* () {
                try {
                  for (;;) {
                    const part = await reader.read()
                    if (part.done) {
                      break
                    }
                    yield part.value
                  }
                } finally {
                  await reader.cancel().catch(() => {})
                  reader.releaseLock()
                }
              })()
            ),
            response
          )
        } else {
          response.end()
        }
      } catch {
        if (!response.headersSent) {
          response.writeHead(410).end()
        } else {
          response.destroy()
        }
      } finally {
        activeRequests--
        grant.abort.signal.removeEventListener('abort', cancel)
        response.removeListener('close', cancel)
      }
    })()
  }
}
