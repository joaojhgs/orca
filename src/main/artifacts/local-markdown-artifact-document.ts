import { Marked, Renderer } from 'marked'

const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)

const STYLES = `
:root{color-scheme:light dark;--background:Canvas;--foreground:CanvasText;--muted-foreground:GrayText;--muted:color-mix(in srgb,CanvasText 5%,Canvas);--border:color-mix(in srgb,CanvasText 20%,Canvas);--ring:CanvasText;--radius:.625rem}
*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--foreground);font:16px/1.6 Geist,system-ui,sans-serif;letter-spacing:.01em}
.artifact-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem;padding:.75rem clamp(1rem,2vw,2rem);border-bottom:1px solid var(--border);font-size:.875rem;line-height:1.5}
.artifact-toolbar span,.artifact-toolbar small{color:var(--muted-foreground)}.artifact-toolbar small{margin-left:auto}
.artifact-toolbar a{padding:.25rem .75rem;border:1px solid var(--border);border-radius:calc(var(--radius)*.8);text-decoration:none;color:var(--foreground)}.artifact-toolbar a:hover,.artifact-toolbar a[aria-current=page]{background:var(--muted)}
a:focus-visible,.artifact-table:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.artifact-document{width:100%;min-width:0;margin:0;padding:1.5rem clamp(1rem,2vw,2rem);overflow-wrap:anywhere}
.artifact-document[data-layout=a4]{max-width:210mm;margin:1.5rem auto}
.artifact-document>:first-child{margin-top:0}.artifact-document img{max-width:100%;height:auto}
.artifact-document pre{max-width:100%;overflow:auto;padding:1rem;background:var(--muted);border-radius:calc(var(--radius)*.8);overflow-wrap:normal}
.artifact-document blockquote{margin-inline:0;padding-inline:1rem;border-inline-start:3px solid var(--border);color:var(--muted-foreground)}
.artifact-table{width:100%;max-width:100%;overflow-x:auto;margin-block:1rem}.artifact-table table{width:100%;border-collapse:collapse;table-layout:auto}
.artifact-table th,.artifact-table td{min-width:8rem;max-width:32rem;padding:.5rem .75rem;border:1px solid var(--border);vertical-align:top;text-align:start;overflow-wrap:anywhere}.artifact-table th{background:var(--muted)}
@media(max-width:480px){.artifact-toolbar small{width:100%;margin-left:0}}
@page{size:A4;margin:18mm}@media print{.artifact-toolbar{display:none}.artifact-document,.artifact-document[data-layout=a4]{width:auto;max-width:none;margin:0;padding:0}.artifact-table{overflow:visible}}
`

export async function renderLocalMarkdownArtifactDocument(
  content: string,
  url: URL,
  fileName: string
): Promise<string> {
  const layout = url.searchParams.get('layout') === 'a4' ? 'a4' : 'full-width'
  const parser = new Marked({
    renderer: {
      table(token) {
        return `<div class="artifact-table" role="region" aria-label="Scrollable table" tabindex="0">${Renderer.prototype.table.call(this, token)}</div>`
      }
    }
  })
  const markdown = await parser.parse(content)
  const link = (value: string, label: string): string =>
    `<a href="${escape(url.pathname)}?layout=${value}"${layout === value ? ' aria-current="page"' : ''}>${label}</a>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(fileName)}</title><style>${STYLES}</style></head><body><nav class="artifact-toolbar" aria-label="Document layout"><span>Layout</span>${link('full-width', 'Full width')}${link('a4', 'Centered A4')}<small>Copy the page URL to share this layout.</small></nav><main class="artifact-document" data-layout="${layout}">${markdown}</main></body></html>`
}
