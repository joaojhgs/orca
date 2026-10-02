import { z } from 'zod'
import {
  SkillLibraryIdSchema,
  SkillLibraryVersionSchema,
  SkillLibraryAssignmentSchema
} from './skill-library-contract'

const libraryWorkerDestinationSchema = z
  .object({
    scope: z.enum(['global', 'workspace']),
    workspaceDirectory: z.string().min(1).max(16384).optional(),
    destinationIdentity: z.string().min(1).max(1000),
    hostIdentity: z.string().min(1).max(200)
  })
  .strict()
  .refine((row) =>
    row.scope === 'global'
      ? row.workspaceDirectory === undefined
      : row.workspaceDirectory !== undefined
  )

export const skillLibraryWorkerRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('library-discover') }).strict(),
  z
    .object({
      operation: z.literal('library-package'),
      candidateId: z.string().min(1).max(200),
      packageId: SkillLibraryIdSchema,
      versionId: SkillLibraryIdSchema,
      exportId: SkillLibraryIdSchema
    })
    .strict(),
  z.object({ operation: z.literal('library-cleanup'), exportId: SkillLibraryIdSchema }).strict(),
  z.object({ operation: z.literal('library-stage'), exportId: SkillLibraryIdSchema }).strict(),
  z
    .object({
      operation: z.literal('library-install'),
      exportId: SkillLibraryIdSchema,
      version: SkillLibraryVersionSchema,
      providers: SkillLibraryAssignmentSchema.shape.providers,
      destination: libraryWorkerDestinationSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal('library-remove'),
      version: SkillLibraryVersionSchema,
      providers: SkillLibraryAssignmentSchema.shape.providers,
      destination: libraryWorkerDestinationSchema
    })
    .strict()
])
export type SkillLibraryWorkerRequest = z.infer<typeof skillLibraryWorkerRequestSchema>
