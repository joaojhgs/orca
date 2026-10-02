import { createHash, timingSafeEqual } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SkillLibraryStore } from './skill-library-store'

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char
  )

export async function serveLocalSkillShare(
  userDataPath: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const match =
    /^\/skills\/share\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/([a-f0-9-]{36})\/([a-f0-9]{64})(?:\/(archive|manifest))?$/.exec(
      url.pathname
    )
  if (!match) {
    return false
  }
  try {
    const root = join(userDataPath, 'skill-library', match[1]!)
    const catalogFile = await lstat(join(root, 'catalog.json'))
    if (!catalogFile.isFile() || catalogFile.isSymbolicLink()) {
      throw new Error('Invalid skill catalog')
    }
    const catalog = await new SkillLibraryStore(root).snapshot()
    const share = catalog.shares?.find((row) => row.id === match[2])
    if (!share || !timingSafeEqual(Buffer.from(share.token), Buffer.from(match[3]!))) {
      throw new Error('Unknown link')
    }
    response.setHeader(
      'Content-Security-Policy',
      "sandbox allow-downloads; default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
    )
    if (match[4] === 'archive') {
      const published = join(root, 'published')
      const dir = await lstat(published)
      const archive = join(published, `${share.id}.tar.gz`)
      const stat = await lstat(archive)
      if (
        !dir.isDirectory() ||
        dir.isSymbolicLink() ||
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size !== share.compressedBytes
      ) {
        throw new Error('Invalid published archive')
      }
      const bytes = await readFile(archive)
      if (
        bytes.length !== share.compressedBytes ||
        createHash('sha256').update(bytes).digest('hex') !== share.archiveSha256
      ) {
        throw new Error('Published archive changed')
      }
      response.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Content-Length': bytes.length,
        'Content-Disposition': `attachment; filename="${share.manifest.bundleName}.tar.gz"`
      })
      response.end(request.method === 'HEAD' ? undefined : bytes)
    } else if (match[4] === 'manifest') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(
        request.method === 'HEAD'
          ? undefined
          : JSON.stringify({
              manifest: share.manifest,
              archiveSha256: share.archiveSha256,
              compressedBytes: share.compressedBytes
            })
      )
    } else {
      const skills = share.manifest.skills
        .map(
          (skill) =>
            `<section><h2>${escape(skill.name)}</h2><p>${escape(skill.description)}</p><details><summary>${skill.files.length} files</summary><ul>${skill.files.map((file) => `<li>${escape(file.path)} (${file.size} bytes${file.executable ? ', executable' : ''})</li>`).join('')}</ul></details></section>`
        )
        .join('')
      const content = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(share.manifest.bundleName)}</title><style>body{font:16px system-ui;max-width:72ch;margin:2rem auto;padding:0 1rem;line-height:1.6;overflow-wrap:anywhere}</style></head><body><h1>${escape(share.manifest.bundleName)}</h1><p>Server-local skill snapshots. Review instructions and scripts before installing; downloading does not execute them.</p><p><a href="${url.pathname}/archive" download>Download skill bundle</a> · <a href="${url.pathname}/manifest">View verified manifest</a></p>${skills}</body></html>`
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(request.method === 'HEAD' ? undefined : content)
    }
  } catch {
    if (!response.headersSent) {
      response.writeHead(404)
    }
    response.end('Skill link unavailable')
  }
  return true
}
