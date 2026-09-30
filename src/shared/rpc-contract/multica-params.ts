import { z } from 'zod'

const optionalId = z.string().trim().min(1).optional()
export const MulticaListProjects = z.object({ workspaceId: optionalId }).optional()
export const MulticaListIssues = z
  .object({
    workspaceId: optionalId,
    projectId: optionalId,
    status: optionalId,
    limit: z.number().int().min(1).max(200).optional()
  })
  .optional()
