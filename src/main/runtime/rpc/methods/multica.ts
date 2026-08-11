import { z } from 'zod'
import { defineMethod, type RpcAnyMethod } from '../core'
import {
  listMulticaIssues,
  listMulticaProjects,
  listMulticaWorkspaces
} from '../../../multica/cli-client'

const optionalId = z.string().trim().min(1).optional()

export const MULTICA_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'multica.listWorkspaces',
    params: null,
    handler: () => listMulticaWorkspaces()
  }),
  defineMethod({
    name: 'multica.listProjects',
    params: z.object({ workspaceId: optionalId }).optional(),
    handler: (params) => listMulticaProjects(params?.workspaceId)
  }),
  defineMethod({
    name: 'multica.listIssues',
    params: z
      .object({
        workspaceId: optionalId,
        projectId: optionalId,
        status: optionalId,
        limit: z.number().int().min(1).max(200).optional()
      })
      .optional(),
    handler: (params) => listMulticaIssues(params ?? {})
  })
]
