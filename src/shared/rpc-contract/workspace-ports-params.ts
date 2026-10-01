import { z } from 'zod'
import { OptionalString, requiredNumber } from './rpc-param-primitives'

export const WorkspacePortScanParams = z.object({
  repoId: OptionalString,
  includeSsh: z.boolean().optional()
})

export const WorkspacePortKillParams = z.object({
  repoId: OptionalString,
  connectionId: OptionalString,
  pid: requiredNumber('Missing process id'),
  port: requiredNumber('Missing port')
})
