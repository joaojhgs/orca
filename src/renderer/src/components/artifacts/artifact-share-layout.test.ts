import { describe, expect, it } from 'vitest'
import { artifactShareLayoutUrl } from './artifact-share-layout'

describe('artifactShareLayoutUrl', () => {
  const url = 'https://orca.example/a/local-default/id/secret?download=1#table'
  it('adds only the layout query and preserves the namespace, identifier, secret and fragment', () => {
    expect(artifactShareLayoutUrl(url, 'a4')).toBe(`${url.split('#')[0]}&layout=a4#table`)
  })
  it('removes a previous A4 layout for the default full width', () => {
    expect(artifactShareLayoutUrl(artifactShareLayoutUrl(url, 'a4'), 'full-width')).toBe(url)
  })
})
