import { defineMethod } from '../core'

export const WORKSPACE_SPACE_METHODS = [
  defineMethod({
    name: 'workspaceSpace.analyze',
    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => await runtime.analyzeWorkspaceSpace()
  }),
  defineMethod({
    name: 'workspaceSpace.cancel',
    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => runtime.cancelWorkspaceSpaceAnalysis()
  })
]
