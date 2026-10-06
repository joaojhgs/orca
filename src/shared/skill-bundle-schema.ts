import { z } from 'zod'
import { SkillPackageFileSchema } from './skill-package-schema'

export const SKILL_BUNDLE_SCHEMA_VERSION = 1 as const
export const AGENT_PLUGIN_SCHEMA_V1 =
  'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json' as const
export const ORCA_SKILL_BUNDLE_MANIFEST_PATH = 'dev.orca.skill-sharing/manifest.json'
export const AGENT_PLUGIN_MANIFEST_PATH = 'plugin.json'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const PLUGIN_NAME_PATTERN = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/

const AgentPluginAuthorSchema = z
  .object({ name: z.string().optional(), email: z.string().optional(), url: z.string().optional() })
  .strict()

export const AgentPluginManifestV1Schema = z
  .object({
    $schema: z.literal(AGENT_PLUGIN_SCHEMA_V1),
    name: z.string().min(1).max(64).regex(PLUGIN_NAME_PATTERN),
    version: z.string().optional(),
    description: z.string().optional(),
    author: AgentPluginAuthorSchema.optional(),
    homepage: z.string().optional(),
    repository: z.string().optional(),
    license: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    extensions: z.record(z.string(), z.record(z.string(), z.unknown())).optional()
  })
  .strict()

export type AgentPluginManifestV1 = z.infer<typeof AgentPluginManifestV1Schema>

export const SkillBundleEntrySchema = z
  .object({
    id: z.string().regex(ID_PATTERN),
    name: z.string(),
    description: z.string().max(4096),
    digest: z.string().regex(SHA256_PATTERN),
    files: z.array(SkillPackageFileSchema).min(1).max(512)
  })
  .strict()

export type SkillBundleEntry = z.infer<typeof SkillBundleEntrySchema>

export const SkillBundleManifestV1Schema = z
  .object({
    schemaVersion: z.literal(SKILL_BUNDLE_SCHEMA_VERSION),
    packageId: z.string().regex(ID_PATTERN),
    versionId: z.string().regex(ID_PATTERN),
    bundleName: z.string().min(1).max(64).regex(PLUGIN_NAME_PATTERN),
    description: z.string().max(4096),
    createdAt: z.iso.datetime({ offset: true }),
    skills: z.array(SkillBundleEntrySchema).min(1).max(512),
    bundleDigest: z.string().regex(SHA256_PATTERN)
  })
  .strict()

export type SkillBundleManifestV1 = z.infer<typeof SkillBundleManifestV1Schema>
