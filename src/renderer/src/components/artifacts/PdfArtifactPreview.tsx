import { useEffect, useState } from 'react'
import { ARTIFACT_MAX_CONTENT_BYTES } from '../../../../shared/artifacts'
import PdfViewer from '../editor/PdfViewer'
import { translate } from '@/i18n/i18n'

/** Read a bounded document; never render PDF bytes as HTML or relax the HTML iframe sandbox. */
async function readPdf(response: Response): Promise<string> {
  if (!response.ok || !response.headers.get('content-type')?.startsWith('application/pdf')) {
    throw new Error('PDF unavailable')
  }
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('PDF response is empty')
  }
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      bytes += value.byteLength
      if (bytes > ARTIFACT_MAX_CONTENT_BYTES) {
        throw new Error('PDF exceeds the artifact size limit')
      }
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  let binary = ''
  for (const chunk of chunks) {
    for (let offset = 0; offset < chunk.length; offset += 8192) {
      binary += String.fromCharCode(...chunk.subarray(offset, offset + 8192))
    }
  }
  return btoa(binary)
}

export function PdfArtifactPreview({
  shareUrl,
  fileName
}: {
  shareUrl: string
  fileName: string
}): React.JSX.Element {
  const [document, setDocument] = useState<{ url: string; content: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let disposed = false
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    setDocument(null)
    setError(null)
    void fetch(shareUrl, {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    })
      .then(readPdf)
      .then((content) => {
        if (!controller.signal.aborted) {
          setDocument({ url: shareUrl, content })
        }
      })
      .catch(() => {
        if (!disposed) {
          setError(
            translate(
              'artifacts.pdfUnavailable',
              'PDF preview unavailable. Open the shared link to view or download it.'
            )
          )
        }
      })
      .finally(() => clearTimeout(timer))
    return () => {
      disposed = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [shareUrl])
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="artifact-pdf-preview">
      {error ? (
        <p role="alert" className="p-4 text-sm text-muted-foreground">
          {error}
        </p>
      ) : document?.url === shareUrl ? (
        <PdfViewer content={document.content} filePath={fileName} />
      ) : (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          {translate('artifacts.pdfLoading', 'Loading PDF…')}
        </p>
      )}
    </div>
  )
}
