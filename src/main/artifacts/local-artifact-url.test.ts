import { describe, expect, it } from 'vitest'
import {
  localArtifactShareUrl,
  localArtifactUrlFileName,
  parseLocalArtifactPathname
} from './local-artifact-url'

const token = 'ff'.repeat(32)
const slug = '11111111-1111-4111-8111-111111111111'
const url = () =>
  new URL(localArtifactShareUrl('https://orca.example', 'local-default', token, 'report final.pdf'))

describe('local artifact readable URLs', () => {
  it('uses a filename and the complete 256-bit capability without a redundant UUID', () => {
    const result = url()
    expect(result.pathname).toBe(
      `/a/local-default/${Buffer.from(token, 'hex').toString('base64url')}/report-final.pdf`
    )
    expect(result.pathname).not.toContain(slug)
    expect(parseLocalArtifactPathname(result.pathname)).toEqual({
      profileId: 'local-default',
      viewToken: token
    })
  })
  it('continues to parse existing UUID and hex-token links', () => {
    expect(parseLocalArtifactPathname(`/a/local-default/${slug}/${token}`)).toEqual({
      profileId: 'local-default',
      slug,
      viewToken: token
    })
  })
  it('handles Unicode, Windows paths, separators and control characters safely', () => {
    expect(localArtifactUrlFileName('C:\\private\\Résumé final.pdf')).toBe('Résumé-final.pdf')
    expect(localArtifactUrlFileName('/private/report?#.md')).toBe('report-.md')
    expect(localArtifactUrlFileName('...')).toBe('artifact')
    expect(localArtifactUrlFileName('report\u0000\nfinal.md')).toBe('report-final.md')
    const unicode = new URL(
      localArtifactShareUrl('https://orca.example', 'local-default', token, 'Résumé final.pdf')
    )
    expect(decodeURIComponent(unicode.pathname)).toContain('Résumé-final.pdf')
    expect(parseLocalArtifactPathname(unicode.pathname)?.viewToken).toBe(token)
  })
  it('bounds long names while retaining the document extension', () => {
    const name = localArtifactUrlFileName(`${'a'.repeat(500)}.pdf`)
    expect(Array.from(name)).toHaveLength(120)
    expect(name.endsWith('.pdf')).toBe(true)
  })
  it('rejects noncanonical capability encodings even when they decode to the same bytes', () => {
    const noncanonical = url().pathname.replace(/8\/report/, '9/report')
    expect(parseLocalArtifactPathname(noncanonical)).toBeNull()
  })
  it('rejects malformed encodings, traversal labels, encoded separators and missing capabilities', () => {
    const prefix = url().pathname.slice(0, url().pathname.lastIndexOf('/') + 1)
    for (const name of ['%', '%2fetc', '%5cetc', '%00', '%2e%2e', '%0a', '']) {
      expect(parseLocalArtifactPathname(prefix + name)).toBeNull()
    }
    expect(parseLocalArtifactPathname('/a/local-default/report.pdf')).toBeNull()
    expect(parseLocalArtifactPathname(`/a/../${'A'.repeat(43)}/report.pdf`)).toBeNull()
  })
})
