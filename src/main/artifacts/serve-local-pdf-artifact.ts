import type { IncomingMessage, ServerResponse } from 'node:http'
import { once } from 'node:events'
import { createMediaRangeResponse } from '../media/media-range-response'
import { readPdfBase64Range } from './pdf-artifact-content'

export async function serveLocalPdfArtifact(
  request: IncomingMessage,
  response: ServerResponse,
  record: { content: string; file_name: string; byte_size: number }
): Promise<void> {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; base-uri 'none'; form-action 'none'"
  )
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader(
    'Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(record.file_name)}`
  )
  const abort = new AbortController()
  const cancel = () => abort.abort()
  response.once('close', cancel)
  const headers = new Headers()
  if (request.headers.range) {
    headers.set('range', request.headers.range)
  }
  try {
    const result = await createMediaRangeResponse(
      new Request('http://localhost/artifact', {
        method: request.method,
        headers,
        signal: abort.signal
      }),
      'application/pdf',
      {
        size: record.byte_size,
        read: async (offset, length) => readPdfBase64Range(record.content, offset, length),
        close: async () => {}
      }
    )
    response.statusCode = result.status
    result.headers.forEach((value, key) => response.setHeader(key, value))
    if (!result.body) {
      response.end()
      return
    }
    const reader = result.body.getReader()
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) {
          break
        }
        if (!response.write(part.value)) {
          await once(response, 'drain', { signal: abort.signal })
        }
      }
      response.end()
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  } finally {
    response.removeListener('close', cancel)
  }
}
