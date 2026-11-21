export type ArtifactMarkdownLayout = 'full-width' | 'a4'

export function artifactShareLayoutUrl(url: string, layout: ArtifactMarkdownLayout): string {
  const result = new URL(url)
  if (layout === 'a4') {
    result.searchParams.set('layout', 'a4')
  } else {
    result.searchParams.delete('layout')
  }
  return result.href
}
