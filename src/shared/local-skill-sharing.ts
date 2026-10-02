import { z } from 'zod'
import { SkillBundleManifestV1Schema } from './skill-bundle-manifest'
import { SkillPackageIdentitySchema } from './skill-install-contract'

export const LOCAL_SKILL_SHARING_CAPABILITY = 'skills.local-sharing.v1' as const
export const LocalSkillShareSchema = z.object({
  id: z.uuid(),
  token: z.string().regex(/^[a-f0-9]{64}$/),
  versionIds: z.array(z.uuid()).min(1).max(50),
  createdAt: z.iso.datetime({ offset: true }),
  manifest: SkillBundleManifestV1Schema,
  archiveSha256: SkillPackageIdentitySchema.shape.archiveSha256,
  compressedBytes: SkillPackageIdentitySchema.shape.compressedBytes
})
export type LocalSkillShare = z.infer<typeof LocalSkillShareSchema>
export const LocalSkillPublishParams = z.object({
  versionIds: z.array(z.uuid()).min(1).max(50),
  bundleName: SkillBundleManifestV1Schema.shape.bundleName,
  reviewed: z.literal(true)
})
export const LocalSkillRevokeParams = z.object({ shareId: z.uuid() })
