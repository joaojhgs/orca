import { useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'

function previewDocument(content: string): string {
  const doc = new DOMParser().parseFromString(content, 'text/html')
  doc.querySelectorAll('base, meta[http-equiv]').forEach((element) => element.remove())
  const policy = doc.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content =
    "default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; media-src data: blob: https:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
  doc.head.prepend(policy)
  return `<!doctype html>${doc.documentElement.outerHTML}`
}

export default function HtmlFileSurface({
  content,
  filePath,
  children
}: {
  content: string
  filePath: string
  children: ReactNode
}): React.JSX.Element {
  const t = useTranslate()
  const [preview, setPreview] = useState(true)
  const document = useMemo(() => (preview ? previewDocument(content) : ''), [content, preview])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex justify-end gap-1 border-b px-3 py-1">
        <Button
          variant={preview ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setPreview(true)}
        >
          {t('htmlPreview.preview', 'Preview')}
        </Button>
        <Button
          variant={preview ? 'ghost' : 'secondary'}
          size="sm"
          onClick={() => setPreview(false)}
        >
          {t('htmlPreview.source', 'Source')}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {preview ? (
          <iframe
            title={filePath}
            srcDoc={document}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            className="h-full w-full border-0 bg-background"
          />
        ) : (
          children
        )}
      </div>
    </div>
  )
}
