import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

describe('skill library browser boundary', () => {
  it('bundles shared library and sharing schemas without Node crypto', async () => {
    const result = await build({
      entryPoints: ['src/shared/skill-library-contract.ts', 'src/shared/local-skill-sharing.ts'],
      outdir: 'unused-browser-boundary',
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
      metafile: true,
      logLevel: 'silent'
    })
    expect(result.outputFiles).toHaveLength(2)
    const inputs = Object.keys(result.metafile?.inputs ?? {})
    expect(inputs.some((path) => path.endsWith('/skill-package-schema.ts'))).toBe(true)
    expect(inputs.some((path) => path.endsWith('/skill-bundle-schema.ts'))).toBe(true)
    expect(inputs.some((path) => path.endsWith('/skill-package-manifest.ts'))).toBe(false)
    expect(inputs.some((path) => path.endsWith('/skill-bundle-manifest.ts'))).toBe(false)
  })
})
