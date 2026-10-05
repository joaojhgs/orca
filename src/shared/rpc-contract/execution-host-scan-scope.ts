import { z } from 'zod'
import { parseExecutionHostId, type ExecutionHostScope } from '../execution-host'

export const ExecutionHostScanScopeSchema = z
  .string()
  .min(1)
  .max(200)
  .transform((value, ctx): ExecutionHostScope => {
    if (value === 'local' || value === 'all') {
      return value
    }
    const host = parseExecutionHostId(value)
    if (host?.kind === 'ssh') {
      return host.id
    }
    ctx.addIssue({ code: 'custom', message: 'Invalid execution host scan scope' })
    return z.NEVER
  })
