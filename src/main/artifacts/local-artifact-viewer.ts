import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { marked } from 'marked'
import { getOrcaProfileDirectory } from '../orca-profiles/profile-storage-paths'
import { LocalArtifactStore } from './local-artifact-store'

export const LOCAL_ARTIFACT_DATABASE = 'local-artifacts.sqlite'

export class LocalArtifactViewer {
  private server: Server | null = null
  private starting: Promise<string> | null = null

  constructor(
    private readonly userDataPath: string,
    private readonly options: { bindHost: string; port: number; publicOrigin?: string }
  ) {}

  start(): Promise<string> {
    this.starting ??= new Promise<string>((resolve, reject) => {
      const server = createServer((request, response) => {
        void this.respond(request, response).catch(() => {
          if (!response.headersSent) {
            response.writeHead(500)
          }
          response.end('Artifact unavailable')
        })
      })
      this.server = server
      server.requestTimeout = 10_000
      server.headersTimeout = 10_000
      server.maxConnections = 32
      server.once('error', reject)
      server.listen(this.options.port, this.options.bindHost, () => {
        server.removeListener('error', reject)
        server.on('error', (error) =>
          console.error('[local-artifacts] Viewer server error:', error.message)
        )
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error('Artifact viewer address unavailable'))
          return
        }
        const host = this.options.bindHost.includes(':')
          ? `[${this.options.bindHost}]`
          : this.options.bindHost
        resolve(this.options.publicOrigin ?? `http://${host}:${address.port}`)
      })
      server.unref()
    }).catch((error) => {
      this.starting = null
      this.server?.close()
      this.server = null
      throw error
    })
    return this.starting
  }

  async close(): Promise<void> {
    const server = this.server
    this.server = null
    this.starting = null
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    }
  }

  private async respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    // Why: opaque sandbox origins prevent artifact scripts from reading Orca or sibling artifacts.
    response.setHeader(
      'Content-Security-Policy',
      "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https: http:; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
    )
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' })
      response.end()
      return
    }
    const url = new URL(request.url ?? '/', 'http://localhost')
    const match = /^\/a\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/([a-f0-9-]{36})\/([a-f0-9]{64})$/.exec(
      url.pathname
    )
    if (!match) {
      response.writeHead(404)
      response.end('Artifact not found')
      return
    }
    let store: LocalArtifactStore | undefined
    try {
      store = new LocalArtifactStore(
        join(getOrcaProfileDirectory(match[1]!, this.userDataPath), LOCAL_ARTIFACT_DATABASE),
        true
      )
      const record = store.bySlug(match[2]!)
      if (!record || !timingSafeEqual(Buffer.from(record.view_token), Buffer.from(match[3]!))) {
        response.writeHead(404)
        response.end('Artifact not found')
        return
      }
      const content =
        record.content_type === 'text/markdown'
          ? `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px system-ui;max-width:72ch;margin:2rem auto;padding:0 1rem;line-height:1.6}pre{overflow:auto}img{max-width:100%}</style></head><body>${await marked.parse(record.content)}</body></html>`
          : record.content
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(request.method === 'HEAD' ? undefined : content)
    } catch {
      if (!response.headersSent) {
        response.writeHead(404)
        response.end('Artifact not found')
      }
    } finally {
      store?.close()
    }
  }
}
