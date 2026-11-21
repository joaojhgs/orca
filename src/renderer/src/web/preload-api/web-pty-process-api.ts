import type { RpcParams } from '../../../../shared/rpc-contract/rpc-params-catalog.generated'
import type { TerminalProcessInspection } from '../../../../shared/terminal/pty/lifecycle/terminal-process-inspection'
import type {
  RuntimeTerminalListResult,
  RuntimeTerminalSummary
} from '../../../../shared/terminal/runtime/runtime-terminal-contracts'
import { callEnvironmentEnvelope } from '../runtime/client/web-runtime-calls'
import { requireActiveEnvironment } from '../runtime/client/web-runtime-session'

type PtyRpcRequest =
  | { method: 'terminal.list'; params: RpcParams<'terminal.list'> }
  | { method: 'terminal.inspectProcess'; params: RpcParams<'terminal.inspectProcess'> }
  | { method: 'terminal.close'; params: RpcParams<'terminal.close'> }

type VerifiedPtyTerminal = RuntimeTerminalSummary & { incarnationId: string }

// Pin both the inventory probe and action to one paired server. Never treat a provider id as a runtime handle.
async function withTerminal<T>(
  id: string,
  action: (
    terminal: VerifiedPtyTerminal,
    call: <R>(request: PtyRpcRequest) => Promise<R>
  ) => Promise<T>,
  expectedOwner?: string
): Promise<T> {
  const owner = requireActiveEnvironment().id
  if (expectedOwner && owner !== expectedOwner) {
    throw new Error('terminal_runtime_owner_changed')
  }
  async function call<R>(request: PtyRpcRequest): Promise<R> {
    const response = await callEnvironmentEnvelope<R>(owner, request.method, request.params)
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    return response.result
  }
  const result = await call<RuntimeTerminalListResult>({
    method: 'terminal.list',
    params: {
      requireFreshPtyLiveness: true,
      includeVisualLayouts: false
    }
  })
  const matches = result.terminals.filter((terminal) => terminal.ptyId === id && terminal.connected)
  if (matches.length !== 1 || !matches[0]?.incarnationId) {
    throw new Error('terminal_liveness_unavailable')
  }
  return action({ ...matches[0], incarnationId: matches[0].incarnationId }, call)
}

export function inspectWebPty(id: string): Promise<TerminalProcessInspection> {
  return withTerminal(id, async (terminal, call) => {
    const result = await call<{ process: TerminalProcessInspection }>({
      method: 'terminal.inspectProcess',
      params: {
        terminal: terminal.handle,
        expectedIncarnationId: terminal.incarnationId,
        scanChildProcesses: true
      }
    })
    return result.process
  })
}

export function killWebPty(id: string, expectedOwner?: string): Promise<void> {
  return withTerminal(
    id,
    async (terminal, call) => {
      await call({
        method: 'terminal.close',
        params: {
          terminal: terminal.handle,
          expectedIncarnationId: terminal.incarnationId
        }
      })
    },
    expectedOwner
  )
}
