// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../editor/PdfViewer', () => ({
  default: ({ content, filePath }: { content: string; filePath: string }) => (
    <div data-testid="pdf-viewer" data-content={content}>
      {filePath}
    </div>
  )
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
import { PdfArtifactPreview } from './PdfArtifactPreview'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe('local PDF artifact preview', () => {
  it('fetches document bytes without credentials and reuses the existing PDF viewer', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4\npreview')
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(bytes, { headers: { 'content-type': 'application/pdf' } }))
    vi.stubGlobal('fetch', fetch)
    render(
      <PdfArtifactPreview shareUrl="http://server:6769/a/document/token" fileName="report.pdf" />
    )
    expect(await screen.findByTestId('pdf-viewer')).toHaveAttribute(
      'data-content',
      btoa('%PDF-1.4\npreview')
    )
    expect(fetch).toHaveBeenCalledWith(
      'http://server:6769/a/document/token',
      expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' })
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it.each([404, 200])(
    'does not render a missing or HTML response (%i) as a PDF',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('<html>not a PDF</html>', {
            status,
            headers: { 'content-type': 'text/html' }
          })
        )
      )
      render(
        <PdfArtifactPreview shareUrl="http://server:6769/a/deleted/token" fileName="report.pdf" />
      )
      expect(await screen.findByRole('alert')).toHaveTextContent('PDF preview unavailable')
      expect(screen.queryByTestId('pdf-viewer')).not.toBeInTheDocument()
    }
  )
})
