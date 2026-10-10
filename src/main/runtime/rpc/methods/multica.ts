import {
  MulticaListIssues,
  MulticaListProjects
} from '../../../../shared/rpc-contract/multica-params'
import { defineMethod } from '../core'
import {
  listMulticaIssues,
  listMulticaProjects,
  listMulticaWorkspaces
} from '../../../multica/cli-client'

export const MULTICA_METHODS = [
  defineMethod({
    name: 'multica.listWorkspaces',
    permission: 'workspace',
    params: null,
    handler: () => listMulticaWorkspaces()
  }),
  defineMethod({
    name: 'multica.listProjects',
    permission: 'workspace',
    params: MulticaListProjects,
    handler: (params) => listMulticaProjects(params?.workspaceId)
  }),
  defineMethod({
    name: 'multica.listIssues',
    permission: 'workspace',
    params: MulticaListIssues,
    handler: (params) => listMulticaIssues(params ?? {})
  })
]
