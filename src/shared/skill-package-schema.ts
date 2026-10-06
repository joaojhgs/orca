import { z } from 'zod'

export const SKILL_PACKAGE_SCHEMA_VERSION = 1 as const
export const SKILL_PACKAGE_CONTENT_TYPE = 'application/vnd.orca.skill+tar+gzip'
export const SKILL_PACKAGE_MAX_COMPRESSED_BYTES = 40 * 1024 * 1024
export const SKILL_PACKAGE_MAX_MANIFEST_BYTES = 1024 * 1024

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export const SkillPackageFileSchema = z
  .object({
    path: z.string().min(1).max(1024),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(4 * 1024 * 1024),
    executable: z.boolean(),
    classification: z.enum(['text', 'binary']),
    sha256: z.string().regex(SHA256_PATTERN),
    identitySha256: z.string().regex(SHA256_PATTERN)
  })
  .strict()

export type SkillPackageFile = z.infer<typeof SkillPackageFileSchema>

export const SkillPackageManifestV1Schema = z
  .object({
    schemaVersion: z.literal(SKILL_PACKAGE_SCHEMA_VERSION),
    packageId: z.string().regex(ID_PATTERN),
    versionId: z.string().regex(ID_PATTERN),
    name: z.string().regex(SKILL_NAME_PATTERN),
    description: z.string().max(4096),
    createdAt: z.iso.datetime({ offset: true }),
    files: z.array(SkillPackageFileSchema).min(1).max(512),
    packageDigest: z.string().regex(SHA256_PATTERN)
  })
  .strict()

export type SkillPackageManifestV1 = z.infer<typeof SkillPackageManifestV1Schema>
