import { createHash } from 'node:crypto'
import {
  computeSkillPackageDigest,
  validateSkillPackageName,
  validateSkillPackagePath,
  type SkillPackageFile
} from './skill-package-manifest'
import {
  AgentPluginManifestV1Schema,
  SkillBundleManifestV1Schema,
  type AgentPluginManifestV1,
  type SkillBundleEntry,
  type SkillBundleManifestV1
} from './skill-bundle-schema'
export * from './skill-bundle-schema'

function validateSkillFiles(files: readonly SkillPackageFile[]): void {
  let previousPath: string | null = null
  const foldedPaths = new Set<string>()
  for (const file of files) {
    validateSkillPackagePath(file.path)
    if (previousPath !== null && file.path <= previousPath) {
      throw new Error('skill-bundle-manifest-path-order')
    }
    previousPath = file.path
    const foldedPath = file.path.toLocaleLowerCase('en-US')
    if (foldedPaths.has(foldedPath)) {
      throw new Error('skill-bundle-case-collision')
    }
    foldedPaths.add(foldedPath)
  }
  if (!files.some((file) => file.path === 'SKILL.md')) {
    throw new Error('skill-package-skill-markdown-required')
  }
}

export function computeSkillBundleDigest(skills: readonly SkillBundleEntry[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        skills.map((skill) => ({ id: skill.id, name: skill.name, digest: skill.digest }))
      )
    )
    .digest('hex')
}

export function parseAgentPluginManifest(value: unknown): AgentPluginManifestV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('skill-bundle-plugin-manifest-invalid')
  }
  const candidate = value as Record<string, unknown>
  const extensions =
    candidate.extensions &&
    typeof candidate.extensions === 'object' &&
    !Array.isArray(candidate.extensions)
      ? candidate.extensions
      : undefined
  const parsed = AgentPluginManifestV1Schema.safeParse({
    $schema: candidate.$schema,
    name: candidate.name,
    version: candidate.version,
    description: candidate.description,
    author: candidate.author,
    homepage: candidate.homepage,
    repository: candidate.repository,
    license: candidate.license,
    keywords: candidate.keywords,
    extensions
  })
  if (!parsed.success) {
    throw new Error('skill-bundle-plugin-manifest-invalid')
  }
  return parsed.data
}

export function parseSkillBundleManifest(value: unknown): SkillBundleManifestV1 {
  const parsed = SkillBundleManifestV1Schema.safeParse(value)
  if (!parsed.success) {
    throw new Error('skill-bundle-manifest-invalid')
  }
  const foldedNames = new Set<string>()
  const ids = new Set<string>()
  let totalFiles = 0
  let totalBytes = 0
  let previousName: string | null = null
  for (const skill of parsed.data.skills) {
    validateSkillPackageName(skill.name)
    if (previousName !== null && skill.name <= previousName) {
      throw new Error('skill-bundle-skill-order')
    }
    previousName = skill.name
    const foldedName = skill.name.toLocaleLowerCase('en-US')
    if (foldedNames.has(foldedName) || ids.has(skill.id)) {
      throw new Error('skill-bundle-skill-collision')
    }
    foldedNames.add(foldedName)
    ids.add(skill.id)
    validateSkillFiles(skill.files)
    if (computeSkillPackageDigest(skill.files) !== skill.digest) {
      throw new Error('skill-bundle-skill-digest-mismatch')
    }
    totalFiles += skill.files.length
    totalBytes += skill.files.reduce((sum, file) => sum + file.size, 0)
    if (totalFiles > 512 || totalBytes > 32 * 1024 * 1024) {
      throw new Error('skill-bundle-content-limit')
    }
  }
  if (computeSkillBundleDigest(parsed.data.skills) !== parsed.data.bundleDigest) {
    throw new Error('skill-bundle-digest-mismatch')
  }
  return parsed.data
}
