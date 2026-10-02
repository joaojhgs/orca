import { chmodSync, mkdirSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import Database from '../sqlite/sync-database'
import { z } from 'zod'
import {
  ARTIFACT_MAX_CONTENT_BYTES,
  artifactContentByteLength,
  type ArtifactListItem,
  type ArtifactWriteRequest
} from '../../shared/artifacts'

const MAX_STORED_BYTES = 200 * 1024 * 1024
const MAX_ARTIFACTS = 1000
const RecordSchema = z.object({
  slug: z.uuid(),
  source_key: z.string(),
  view_token: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string(),
  content_type: z.enum(['text/html', 'text/markdown', 'application/pdf']),
  file_name: z.string(),
  title: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  byte_size: z.number()
})
export type LocalArtifactRecord = z.infer<typeof RecordSchema>
const MetadataSchema = RecordSchema.omit({ content: true })
type LocalArtifactMetadata = z.infer<typeof MetadataSchema>

export class LocalArtifactStore {
  private readonly db: Database

  constructor(filePath: string, readonly = false) {
    if (!readonly) {
      mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
    }
    this.db = new Database(filePath, { readonly, fileMustExist: readonly })
    if (!readonly) {
      chmodSync(filePath, 0o600)
      this.db.exec(`CREATE TABLE IF NOT EXISTS artifacts (
        slug TEXT PRIMARY KEY, source_key TEXT UNIQUE NOT NULL, view_token TEXT NOT NULL,
        content TEXT NOT NULL, content_type TEXT NOT NULL, file_name TEXT NOT NULL, title TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, byte_size INTEGER NOT NULL
      )`)
    }
  }

  close(): void {
    this.db.close()
  }

  list(cursor?: string): LocalArtifactMetadata[] {
    if (cursor && !z.uuid().safeParse(cursor).success) {
      throw new Error('Invalid artifact cursor')
    }
    const rows = this.db
      .prepare(
        'SELECT slug, source_key, view_token, content_type, file_name, title, created_at, updated_at, byte_size FROM artifacts WHERE slug > ? ORDER BY slug LIMIT 51'
      )
      .all(cursor ?? '')
    return rows.map((row) => MetadataSchema.parse(row))
  }

  bySource(sourceKey: string): LocalArtifactRecord | null {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE source_key = ?').get(sourceKey)
    return row ? RecordSchema.parse(row) : null
  }

  bySlug(slug: string): LocalArtifactRecord | null {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE slug = ?').get(slug)
    return row ? RecordSchema.parse(row) : null
  }

  write(
    request: ArtifactWriteRequest,
    requireExisting: boolean
  ): { change: 'created' | 'updated'; record: LocalArtifactRecord } {
    const bytes = artifactContentByteLength(request.content)
    if (!bytes || bytes > ARTIFACT_MAX_CONTENT_BYTES) {
      throw new Error('Artifact content is empty or exceeds 10 MiB')
    }
    if (
      !request.sourceKey ||
      request.sourceKey.length > 4096 ||
      !request.fileName ||
      request.fileName.length > 1024 ||
      (request.title?.length ?? 0) > 1024
    ) {
      throw new Error('Invalid artifact metadata')
    }
    if (!['text/html', 'text/markdown', 'application/pdf'].includes(request.contentType)) {
      throw new Error('Unsupported artifact content type')
    }
    let documentBytes = bytes
    if (request.contentType === 'application/pdf') {
      const pdf = Buffer.from(request.content, 'base64')
      if (pdf.toString('base64') !== request.content || pdf.subarray(0, 5).toString() !== '%PDF-') {
        throw new Error('Invalid PDF artifact: expected canonical base64 PDF content')
      }
      documentBytes = pdf.byteLength
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.bySource(request.sourceKey)
      if (requireExisting && !existing) {
        throw new Error('Artifact has not been published')
      }
      const totals = z
        .object({ bytes: z.number(), count: z.number() })
        .parse(
          this.db
            .prepare(
              'SELECT COALESCE(SUM(length(CAST(content AS BLOB))), 0) AS bytes, COUNT(*) AS count FROM artifacts'
            )
            .get()
        )
      if (
        totals.bytes - (existing ? artifactContentByteLength(existing.content) : 0) + bytes >
          MAX_STORED_BYTES ||
        (!existing && totals.count >= MAX_ARTIFACTS)
      ) {
        throw new Error('Local artifact storage limit reached; remove unused artifacts')
      }
      const timestamp = new Date().toISOString()
      const record: LocalArtifactRecord = {
        slug: existing?.slug ?? randomUUID(),
        source_key: request.sourceKey,
        view_token: existing?.view_token ?? randomBytes(32).toString('hex'),
        content: request.content,
        content_type: request.contentType,
        file_name: request.fileName,
        title: request.title ?? null,
        created_at: existing?.created_at ?? timestamp,
        updated_at: timestamp,
        byte_size: documentBytes
      }
      this.db
        .prepare(`INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_key) DO UPDATE SET content=excluded.content, content_type=excluded.content_type,
        file_name=excluded.file_name, title=excluded.title, updated_at=excluded.updated_at, byte_size=excluded.byte_size`)
        .run(
          record.slug,
          record.source_key,
          record.view_token,
          record.content,
          record.content_type,
          record.file_name,
          record.title,
          record.created_at,
          record.updated_at,
          record.byte_size
        )
      this.db.exec('COMMIT')
      return { change: existing ? 'updated' : 'created', record }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  delete(slug: string): void {
    this.db.prepare('DELETE FROM artifacts WHERE slug = ?').run(slug)
  }
}

export function localArtifactItem(
  record: LocalArtifactMetadata,
  origin: string,
  profileId: string
): ArtifactListItem {
  return {
    artifact: {
      version: 1,
      slug: record.slug,
      title: record.title,
      originalFileName: record.file_name,
      sourceContentType: record.content_type,
      renderedContentType:
        record.content_type === 'application/pdf' ? 'application/pdf' : 'text/html',
      createdAt: record.created_at,
      updatedAt: record.updated_at,
      expiresAt: '9999-12-31T23:59:59.999Z',
      byteSize: record.byte_size,
      deletedAt: null
    },
    shareUrl: `${origin}/a/${encodeURIComponent(profileId)}/${record.slug}/${record.view_token}`
  }
}
