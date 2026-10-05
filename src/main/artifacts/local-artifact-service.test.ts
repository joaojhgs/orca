import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalArtifactService } from './local-artifact-service'

const active = vi.hoisted(() => ({ id: 'local-default' }))
vi.mock('../orca-profiles/profile-index-store', () => ({
  ensureActiveOrcaProfile: (root: string) => ({
    profile: { id: active.id },
    profileDirectory: join(root, 'profiles', active.id)
  })
}))
vi.mock('../orca-profiles/profile-storage-paths', () => ({
  getOrcaProfileDirectory: (id: string, root: string) => join(root, 'profiles', id)
}))

const fixtures: { root: string; service: LocalArtifactService }[] = []
async function fixture(enabled = true) {
  active.id = 'local-default'
  const root = await mkdtemp(join(tmpdir(), 'orca-local-artifacts-'))
  const service = new LocalArtifactService(root, () => enabled, { bindHost: '127.0.0.1', port: 0 })
  fixtures.push({ root, service })
  return service
}

const write = {
  sourceKey: 'test-report',
  content: '# Local report\n\nNo cloud required.',
  contentType: 'text/markdown' as const,
  fileName: 'report.md'
}
afterEach(async () => {
  for (const { root, service } of fixtures.splice(0)) {
    await service.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

describe('server-local artifacts', () => {
  it('hosts PDF bytes with correct metadata, HEAD, stable updates and revocation', async () => {
    const service = await fixture()
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')
    const request = {
      ...write,
      sourceKey: 'test-pdf',
      fileName: 'report é.pdf',
      contentType: 'application/pdf' as const,
      content: pdf.toString('base64')
    }
    expect(await service.hostingStatus()).toMatchObject({ supportsPdf: true })
    const published = await service.publish(request)
    if (published.status !== 'ok') {
      throw new Error('PDF publish failed')
    }
    expect(published.value.item.artifact).toMatchObject({
      renderedContentType: 'application/pdf',
      sourceContentType: 'application/pdf',
      byteSize: pdf.length
    })
    const url = published.value.item.shareUrl
    const response = await fetch(url)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''report%20%C3%A9.pdf"
    )
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf)
    const head = await fetch(url, { method: 'HEAD' })
    expect(head.headers.get('content-length')).toBe(String(pdf.length))
    expect(await head.text()).toBe('')
    expect(await service.publish(request)).toMatchObject({
      status: 'ok',
      value: { change: 'updated', item: { shareUrl: url } }
    })
    await service.unshare({ sourceKey: request.sourceKey })
    expect((await fetch(url)).status).toBe(404)
  })

  it('refuses malformed PDF/base64 and preserves the human publishing gate for PDFs', async () => {
    const service = await fixture()
    for (const content of [
      Buffer.from('<script>oops</script>').toString('base64'),
      '%PDF-plain-text',
      'JVBERi0=\n'
    ]) {
      await expect(
        service.share({ ...write, contentType: 'application/pdf', content })
      ).rejects.toThrow('Invalid PDF')
    }
    expect(await service.list({})).toEqual({ status: 'ok', value: { artifacts: [] } })
    const disabled = await fixture(false)
    await expect(
      disabled.share({
        ...write,
        contentType: 'application/pdf',
        content: Buffer.from('%PDF-1.4').toString('base64')
      })
    ).rejects.toThrow()
  })
  it('serves saved links after startup without listing or republishing artifacts', async () => {
    const service = await fixture()
    const published = await service.share(write)
    const root = fixtures.find((item) => item.service === service)?.root
    if (published.status !== 'ok' || !root) {
      throw new Error('Artifact fixture unavailable')
    }
    await service.dispose()
    const resumed = new LocalArtifactService(root, () => true, { bindHost: '127.0.0.1', port: 0 })
    fixtures.push({ root, service: resumed })
    const hosting = await resumed.hostingStatus()
    if (!hosting.viewerOrigin) {
      throw new Error('Artifact viewer did not start')
    }
    const url = new URL(new URL(published.value.shareUrl).pathname, hosting.viewerOrigin)
    expect((await fetch(url)).status).toBe(200)
  })

  it('publishes, lists, previews Markdown, updates stable links, and revokes without Cloud authentication', async () => {
    const service = await fixture()
    expect(await service.hostingStatus()).toMatchObject({
      backend: 'local',
      requiresCloudLogin: false
    })
    const published = await service.publish(write)
    if (published.status !== 'ok') {
      throw new Error('Publish failed')
    }
    const url = published.value.item.shareUrl
    const response = await fetch(url)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<h1>Local report</h1>')
    expect(response.headers.get('content-security-policy')).toContain('sandbox allow-scripts;')
    expect(response.headers.get('content-security-policy')).not.toContain('allow-same-origin')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await service.getPublishedLink({ sourceKey: write.sourceKey })).toEqual({
      status: 'ok',
      value: { shareUrl: url }
    })
    const update = await service.publish({
      ...write,
      content: '<h1>Updated HTML</h1>',
      contentType: 'text/html'
    })
    expect(update).toMatchObject({
      status: 'ok',
      value: { change: 'updated', item: { shareUrl: url } }
    })
    expect(await (await fetch(url)).text()).toContain('Updated HTML')
    expect(await service.list({})).toMatchObject({
      status: 'ok',
      value: { artifacts: [{ shareUrl: url }] }
    })
    await service.unshare({ sourceKey: write.sourceKey })
    expect((await fetch(url)).status).toBe(404)
    expect(await service.list({})).toEqual({ status: 'ok', value: { artifacts: [] } })
  })

  it('requires the exact view capability and refuses writes on the viewer', async () => {
    const service = await fixture()
    const result = await service.share(write)
    if (result.status !== 'ok') {
      throw new Error('Share failed')
    }
    const url = result.value.shareUrl
    expect((await fetch(url.replace(/[^/]+$/, '0'.repeat(64)))).status).toBe(404)
    expect((await fetch(new URL('/a/../../etc/passwd', url))).status).toBe(404)
    expect((await fetch(url, { method: 'POST', body: 'overwrite' })).status).toBe(405)
    await service.delete(result.value.artifact.slug, {})
    expect((await fetch(url)).status).toBe(404)
  })

  it('keeps local profiles separate and allows revocation while publishing is disabled', async () => {
    const service = await fixture()
    const result = await service.share(write)
    if (result.status !== 'ok') {
      throw new Error('Share failed')
    }
    active.id = 'second-profile'
    expect(await service.list({})).toEqual({ status: 'ok', value: { artifacts: [] } })
    await service.delete(result.value.artifact.slug, {})
    expect((await fetch(result.value.shareUrl)).status).toBe(200)
    active.id = 'local-default'
    await service.delete(result.value.artifact.slug, {})
    expect((await fetch(result.value.shareUrl)).status).toBe(404)
    const disabled = await fixture(false)
    await expect(disabled.share(write)).rejects.toThrow()
    expect(await disabled.list({})).toEqual({ status: 'ok', value: { artifacts: [] } })
    await expect(disabled.delete('missing', {})).resolves.toEqual({
      status: 'ok',
      value: undefined
    })
  })

  it('paginates without duplicates and rejects unsupported or oversized content', async () => {
    const service = await fixture()
    for (let index = 0; index < 51; index++) {
      await service.share({ ...write, sourceKey: `report-${index}` })
    }
    const first = await service.list({})
    if (first.status !== 'ok') {
      throw new Error('List failed')
    }
    expect(first.value.artifacts).toHaveLength(50)
    const second = await service.list({ cursor: first.value.nextCursor })
    if (second.status !== 'ok') {
      throw new Error('List failed')
    }
    expect(second.value.artifacts).toHaveLength(1)
    expect(
      first.value.artifacts.some(
        (item) => item.artifact.slug === second.value.artifacts[0]?.artifact.slug
      )
    ).toBe(false)
    await expect(
      service.share({ ...write, content: 'x'.repeat(10 * 1024 * 1024 + 1) })
    ).rejects.toThrow('10 MiB')
    await expect(service.update({ ...write, sourceKey: 'unpublished' })).rejects.toThrow(
      'not been published'
    )
  })
})
