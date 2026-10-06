import { createHash } from 'node:crypto'
import {
  SkillPackageManifestV1Schema,
  type SkillPackageFile,
  type SkillPackageManifestV1
} from './skill-package-schema'
export * from './skill-package-schema'

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

export function validateSkillPackageName(name: string): void {
  if (!SKILL_NAME_PATTERN.test(name) || WINDOWS_RESERVED_SEGMENT.test(name)) {
    throw new Error('skill-package-skill-name-invalid')
  }
}

export function validateSkillPackagePath(path: string): void {
  if (path !== path.normalize('NFC') || Buffer.byteLength(path, 'utf8') > 1024) {
    throw new Error('skill-package-path-invalid')
  }
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    throw new Error('skill-package-path-invalid')
  }
  const segments = path.split('/')
  if (
    segments.length > 16 ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('skill-package-path-invalid')
  }
  for (const segment of segments) {
    if (
      Buffer.byteLength(segment, 'utf8') > 255 ||
      [...segment].some((character) => character.charCodeAt(0) <= 0x1f) ||
      ':*?"<>|'.split('').some((character) => segment.includes(character)) ||
      /[ .]$/.test(segment) ||
      WINDOWS_RESERVED_SEGMENT.test(segment)
    ) {
      throw new Error('skill-package-path-invalid')
    }
  }
}

export function computeSkillPackageDigest(files: readonly SkillPackageFile[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        files.map((file) => ({
          path: file.path,
          executable: file.executable,
          classification: file.classification,
          identitySha256: file.identitySha256
        }))
      )
    )
    .digest('hex')
}

export function parseSkillPackageManifest(value: unknown): SkillPackageManifestV1 {
  const parsed = SkillPackageManifestV1Schema.safeParse(value)
  if (!parsed.success) {
    throw new Error('skill-package-manifest-invalid')
  }
  validateSkillPackageName(parsed.data.name)
  let previousPath: string | null = null
  const foldedPaths = new Set<string>()
  let totalBytes = 0
  for (const file of parsed.data.files) {
    validateSkillPackagePath(file.path)
    if (previousPath !== null && file.path <= previousPath) {
      throw new Error('skill-package-manifest-path-order')
    }
    previousPath = file.path
    const folded = file.path.toLocaleLowerCase('en-US')
    if (foldedPaths.has(folded)) {
      throw new Error('skill-package-case-collision')
    }
    foldedPaths.add(folded)
    totalBytes += file.size
    if (totalBytes > 32 * 1024 * 1024) {
      throw new Error('skill-package-total-size-limit')
    }
  }
  if (!parsed.data.files.some((file) => file.path === 'SKILL.md')) {
    throw new Error('skill-package-skill-markdown-required')
  }
  if (computeSkillPackageDigest(parsed.data.files) !== parsed.data.packageDigest) {
    throw new Error('skill-package-digest-mismatch')
  }
  return parsed.data
}
