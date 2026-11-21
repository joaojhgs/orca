import { describe, expect, it } from 'vitest'
import { renderLocalMarkdownArtifactDocument } from './local-markdown-artifact-document'

const path = `/a/local-default/artifact-id/${'a'.repeat(64)}`
const table = '| Name | Result |\n| --- | --- |\n| Example | Passed |'

describe('shared Markdown document layout', () => {
  it('uses full width for existing links without a layout parameter', async () => {
    const html = await renderLocalMarkdownArtifactDocument(
      table,
      new URL(path, 'https://orca.example'),
      'report.md'
    )
    expect(html).toContain('data-layout="full-width"')
    expect(html).toContain(`href="${path}?layout=full-width" aria-current="page"`)
    expect(html).toContain(`href="${path}?layout=a4"`)
    expect(html).not.toContain('max-width:72ch')
  })

  it('encodes the selected centered A4 view in the shareable URL', async () => {
    const html = await renderLocalMarkdownArtifactDocument(
      table,
      new URL(`${path}?layout=a4`, 'https://orca.example'),
      'report.md'
    )
    expect(html).toContain('data-layout="a4"')
    expect(html).toContain(`href="${path}?layout=a4" aria-current="page"`)
    expect(html).toContain('max-width:210mm')
  })

  it('keeps tables horizontally scrollable without losing their contents', async () => {
    const html = await renderLocalMarkdownArtifactDocument(
      `${table}\n\n${table}`,
      new URL(path, 'https://orca.example'),
      'report.md'
    )
    expect(html.match(/class="artifact-table"/g)).toHaveLength(2)
    expect(html.match(/<table>/g)).toHaveLength(2)
    expect(html).toContain('aria-label="Scrollable table" tabindex="0"')
    expect(html).toContain('<td>Passed</td>')
    expect(html).toContain('overflow-x:auto')
  })

  it('escapes document metadata and never reflects unrecognized layout values', async () => {
    const html = await renderLocalMarkdownArtifactDocument(
      '# Report',
      new URL(`${path}?layout=%22%3E%3Cscript%3E`, 'https://orca.example'),
      '<img src=x onerror=alert(1)>.md'
    )
    expect(html).toContain('data-layout="full-width"')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>')
  })
})
