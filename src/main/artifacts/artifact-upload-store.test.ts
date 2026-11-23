import { afterEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import {
  appendArtifactUpload,
  beginArtifactUpload,
  consumeArtifactUpload,
  revokeArtifactUploads
} from './artifact-upload-store'

vi.mock('../orca-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => tmpdir()
}))
afterEach(() => revokeArtifactUploads('a'))

describe('chunked artifact publishing', () => {
  it('assembles a large UTF-8 document and refuses incomplete or foreign uploads', async () => {
    const content = '<p>Résumé 🚀</p>\n'.repeat(80_000)
    const bytes = Buffer.from(
      JSON.stringify({ content, contentType: 'text/html', fileName: 'report.html' })
    )
    const { uploadId } = await beginArtifactUpload('a', bytes.length)
    await expect(appendArtifactUpload('b', uploadId, 0, 'eA==')).rejects.toThrow(
      'another connection'
    )
    await expect(consumeArtifactUpload('a', uploadId, async () => null)).rejects.toThrow(
      'incomplete'
    )
    for (let offset = 0; offset < bytes.length; offset += 192 * 1024) {
      await appendArtifactUpload(
        'a',
        uploadId,
        offset,
        bytes.subarray(offset, offset + 192 * 1024).toString('base64')
      )
    }
    const result = await consumeArtifactUpload('a', uploadId, async (request) => request)
    expect(result).toEqual({ content, contentType: 'text/html', fileName: 'report.html' })
    await expect(consumeArtifactUpload('a', uploadId, async () => null)).rejects.toThrow('expired')
  })
})
