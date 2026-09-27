import { defineMethod, type RpcMethod } from '../core'

export const WORKSPACE_SPACE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'workspaceSpace.analyze',
    params: null,
    handler: async (_params, { runtime }) => await runtime.analyzeWorkspaceSpace()
  }),
  defineMethod({
    name: 'workspaceSpace.cancel',
    params: null,
    handler: async (_params, { runtime }) => runtime.cancelWorkspaceSpaceAnalysis()
  })
]
