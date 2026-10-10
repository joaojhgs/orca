import { defineMethod } from '../core'
import { DiagnosticsSessionsParams } from '../../../../shared/rpc-contract/diagnostics-params'

export const DIAGNOSTICS_METHODS = [
  defineMethod({
    name: 'diagnostics.sessions',
    permission: 'workspace',
    params: DiagnosticsSessionsParams,
    handler: async (params) => {
      const { listPtySessions } = await import('../../../ipc/pty/ipc/list-sessions')
      return { sessions: await listPtySessions(params.scope) }
    }
  }),
  defineMethod({
    name: 'diagnostics.memory',
    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => {
      return await runtime.getMemorySnapshot()
    }
  })
]
