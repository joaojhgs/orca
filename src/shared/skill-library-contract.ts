import { z } from 'zod'
import { SkillInstallDestinationSchema, SkillPackageIdentitySchema } from './skill-install-contract'
import { SkillPackageFileSchema } from './skill-package-manifest'

export const SKILL_LIBRARY_CAPABILITY = 'skills.local-library.v1' as const
export const SKILL_LIBRARY_RPC_METHODS = [
  'skills.library.list',
  'skills.library.discover',
  'skills.library.preview',
  'skills.library.import',
  'skills.library.assign',
  'skills.library.unassign',
  'skills.library.reconcile',
  'skills.library.deleteVersion'
] as const
export const SkillLibraryIdSchema = z.string().uuid()
export const SkillLibraryHostSchema = z.string().min(1).max(200)
export const SkillLibraryCandidateSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  description: z.string().max(4096).nullable(),
  sourceLabel: z.string().max(500),
  sourceKind: z.string().max(100),
  providers: z.array(z.string().max(64)).max(64)
})
export type SkillLibraryCandidate = z.infer<typeof SkillLibraryCandidateSchema>

export const SkillLibraryVersionSchema = z.object({
  ...SkillPackageIdentitySchema.shape,
  packageId: SkillLibraryIdSchema,
  versionId: SkillLibraryIdSchema,
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  description: z.string().max(4096),
  createdAt: z.iso.datetime({ offset: true }),
  files: z
    .array(
      z.object({
        path: SkillPackageFileSchema.shape.path,
        size: SkillPackageFileSchema.shape.size,
        executable: z.boolean(),
        classification: z.enum(['text', 'binary'])
      })
    )
    .min(1)
    .max(512),
  origins: z
    .array(
      z.object({
        hostId: SkillLibraryHostSchema,
        candidateId: z.string().max(200),
        sourceLabel: z.string().max(500),
        importedAt: z.iso.datetime({ offset: true })
      })
    )
    .max(128)
})
export type SkillLibraryVersion = z.infer<typeof SkillLibraryVersionSchema>

export const SkillLibraryAssignmentSchema = z.object({
  id: SkillLibraryIdSchema,
  packageId: SkillLibraryIdSchema,
  versionId: SkillLibraryIdSchema,
  destination: SkillInstallDestinationSchema,
  executionHostId: SkillLibraryHostSchema,
  providers: z.array(z.string().min(1).max(64)).min(1).max(64),
  desiredState: z.enum(['installed', 'removed']),
  status: z.enum(['pending', 'installed', 'removed', 'conflict', 'unavailable', 'failed']),
  checkedAt: z.iso.datetime({ offset: true }).nullable(),
  message: z.string().max(1000).nullable()
})
export type SkillLibraryAssignment = z.infer<typeof SkillLibraryAssignmentSchema>

export const SkillLibraryCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  versions: z.array(SkillLibraryVersionSchema).max(2048),
  assignments: z.array(SkillLibraryAssignmentSchema).max(2048)
})
export type SkillLibraryCatalog = z.infer<typeof SkillLibraryCatalogSchema>

export const SkillLibraryDiscoverParams = z.object({
  hostId: SkillLibraryHostSchema.default('local')
})
export const SkillLibraryImportParams = z.object({
  hostId: SkillLibraryHostSchema.default('local'),
  candidateIds: z.array(z.string().min(1).max(200)).min(1).max(50),
  reviewed: z.literal(true),
  addVersion: z.boolean().default(false),
  expectedDigests: z
    .array(
      z.object({
        candidateId: z.string().min(1).max(200),
        packageDigest: SkillPackageIdentitySchema.shape.packageDigest
      })
    )
    .max(50)
    .optional()
})
export const SkillLibraryAssignParams = z.object({
  versionId: SkillLibraryIdSchema,
  destination: SkillInstallDestinationSchema,
  providers: z.array(z.string().min(1).max(64)).min(1).max(64)
})
export const SkillLibraryAssignmentParams = z.object({ assignmentId: SkillLibraryIdSchema })
export const SkillLibraryVersionParams = z.object({ versionId: SkillLibraryIdSchema })
export const SkillLibraryPreviewParams = z.object({
  hostId: SkillLibraryHostSchema.default('local'),
  candidateId: z.string().min(1).max(200),
  filePath: z.string().min(1).max(500).optional()
})
export const SkillLibraryReconcileParams = z.object({
  assignmentId: SkillLibraryIdSchema.optional()
})
export const SkillLibrarySnapshotSchema = SkillLibraryCatalogSchema.extend({
  hosts: z.array(
    z.object({ id: SkillLibraryHostSchema, label: z.string(), reachable: z.boolean() })
  ),
  providers: z.array(z.object({ id: z.string(), displayName: z.string() })),
  workspaces: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(['worktree', 'folder']),
        label: z.string(),
        hostId: SkillLibraryHostSchema
      })
    )
    .max(8192)
})
export type SkillLibrarySnapshot = z.infer<typeof SkillLibrarySnapshotSchema>
export const SkillLibraryPreviewSchema = z.object({
  candidate: SkillLibraryCandidateSchema,
  packageDigest: SkillPackageIdentitySchema.shape.packageDigest,
  files: SkillLibraryVersionSchema.shape.files,
  filePath: z.string().min(1).max(1024),
  content: z.string().max(32768).nullable(),
  truncated: z.boolean()
})
export type SkillLibraryPreview = z.infer<typeof SkillLibraryPreviewSchema>
export const SkillLibraryImportResultSchema = z.object({
  results: z
    .array(
      z.object({
        candidateId: z.string().min(1).max(200),
        status: z.enum(['imported', 'unchanged', 'conflict', 'failed']),
        version: SkillLibraryVersionSchema.optional(),
        message: z.string().max(1000).optional()
      })
    )
    .max(50)
})
