import { z } from 'zod'
import {
  parseExecutionHostId,
  toRuntimeExecutionHostId,
  type ExecutionHostScope
} from '../../../../shared/execution-host'
import { AI_VAULT_EXECUTION_HOSTS_CAPABILITY } from '../../../../shared/protocol-version'
import { callRuntimeResult } from './web-runtime-calls'
import { requireActiveEnvironment } from './web-runtime-session'

export async function webAiVaultHostParams(scope: ExecutionHostScope | undefined): Promise<{
  executionHostScope?: string
} | null> {
  const environment = requireActiveEnvironment()
  if (!scope || scope === 'local' || scope === toRuntimeExecutionHostId(environment.id)) {
    return {}
  }
  if (scope !== 'all' && parseExecutionHostId(scope)?.kind !== 'ssh') {
    return null
  }
  const status = z
    .object({ capabilities: z.array(z.string()).optional() })
    .parse(await callRuntimeResult('status.get', undefined, 15000))
  const current = requireActiveEnvironment()
  if (
    current.id !== environment.id ||
    current.pairingRevision !== environment.pairingRevision ||
    (environment.runtimeId && current.runtimeId !== environment.runtimeId)
  ) {
    throw new Error(
      'The paired runtime changed during the history request. Retry on the selected host.'
    )
  }
  return status.capabilities?.includes(AI_VAULT_EXECUTION_HOSTS_CAPABILITY)
    ? { executionHostScope: scope }
    : null
}
