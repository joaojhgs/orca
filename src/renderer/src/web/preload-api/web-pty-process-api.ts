import type { TerminalProcessInspection } from '../../../../shared/terminal-process-inspection'
import type {
  RuntimeTerminalListResult,
  RuntimeTerminalSummary
} from '../../../../shared/runtime-terminal-contracts'
import { callEnvironmentEnvelope } from './web-runtime-calls'
import { requireActiveEnvironment } from './web-runtime-session'

// Pin both the inventory probe and action to one paired server. Never treat a provider id as a runtime handle.
async function withTerminal<T>(
  id: string,
  action: (
    terminal: RuntimeTerminalSummary,
    call: <R>(method: string, params: object) => Promise<R>
  ) => Promise<T>,
  expectedOwner?: string
): Promise<T> {
  const owner = requireActiveEnvironment().id
  if (expectedOwner && owner !== expectedOwner) {
    throw new Error('terminal_runtime_owner_changed')
  }
  async function call<R>(method: string, params: object): Promise<R> {
    const response = await callEnvironmentEnvelope<R>(owner, method, params)
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    return response.result
  }
  const result = await call<RuntimeTerminalListResult>('terminal.list', {
    requireFreshPtyLiveness: true,
    includeVisualLayouts: false
  })
  const matches = result.terminals.filter((terminal) => terminal.ptyId === id && terminal.connected)
  if (matches.length !== 1 || !matches[0]?.incarnationId) {
    throw new Error('terminal_liveness_unavailable')
  }
  return action(matches[0], call)
}

export function inspectWebPty(id: string): Promise<TerminalProcessInspection> {
  return withTerminal(id, async (terminal, call) => {
    const result = await call<{ process: TerminalProcessInspection }>('terminal.inspectProcess', {
      terminal: terminal.handle,
      expectedIncarnationId: terminal.incarnationId,
      scanChildProcesses: true
    })
    return result.process
  })
}

export function killWebPty(id: string, expectedOwner?: string): Promise<void> {
  return withTerminal(
    id,
    async (terminal, call) => {
      await call('terminal.close', {
        terminal: terminal.handle,
        expectedIncarnationId: terminal.incarnationId
      })
    },
    expectedOwner
  )
}
