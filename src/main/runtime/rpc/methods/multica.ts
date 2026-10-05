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
    params: null,
    handler: () => listMulticaWorkspaces()
  }),
  defineMethod({
    name: 'multica.listProjects',
    params: MulticaListProjects,
    handler: (params) => listMulticaProjects(params?.workspaceId)
  }),
  defineMethod({
    name: 'multica.listIssues',
    params: MulticaListIssues,
    handler: (params) => listMulticaIssues(params ?? {})
  })
]
