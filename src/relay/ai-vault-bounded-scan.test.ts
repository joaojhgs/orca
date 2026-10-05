import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultSession } from '../shared/ai-vault-types'
import { MemoryRemoteProvider } from '../main/ai-vault/remote-session-scanner-test-fixtures'
import { getRemoteHostPlatform } from '../main/ssh/ssh-remote-platform'
import { createAiVaultScanCancelledError } from '../main/ai-vault/ai-vault-scan-cancellation'
const scan = vi.hoisted(() => vi.fn())
vi.mock('../main/ai-vault/remote-session-scanner', () => ({ scanRemoteAiVaultSessions: scan }))
import { scanRelayAiVaultWithinBudget } from './ai-vault-bounded-scan'

const row: AiVaultSession = {
  id: 'local:claude:fixture',
  executionHostId: 'local',
  agent: 'claude',
  sessionId: 'fixture',
  title: 'Fixture',
  cwd: '/repo',
  branch: null,
  model: null,
  filePath: '/home/dev/.claude/projects/fixture.jsonl',
  codexHome: null,
  createdAt: null,
  updatedAt: null,
  modifiedAt: '2026-10-02T00:00:00Z',
  messageCount: 2,
  totalTokens: 0,
  previewMessages: [],
  queuedMessageCount: 0,
  subagentTranscriptCount: 0,
  resumeCommand: 'claude --resume fixture',
  subagent: null
}
const args = {
  provider: new MemoryRemoteProvider(),
  executionHostId: 'local' as const,
  remoteHome: '/home/dev',
  hostPlatform: getRemoteHostPlatform('linux-x64'),
  limit: 1
}
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('bounded relay history scans', () => {
  it('returns completed rows with an explicit partial issue instead of crashing or losing the cache', async () => {
    vi.useFakeTimers()
    scan.mockImplementation(({ signal, onSessionParsed }) => {
      onSessionParsed(row)
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(createAiVaultScanCancelledError()), {
          once: true
        })
      )
    })
    const pending = scanRelayAiVaultWithinBudget(args, 20)
    await vi.advanceTimersByTimeAsync(20)
    expect(await pending).toMatchObject({
      sessions: [row],
      issues: [{ kind: 'host', message: expect.stringContaining('partially scanned') }]
    })
  })
  it('propagates caller cancellation and ordinary faults, never presenting them as partial success', async () => {
    const controller = new AbortController()
    controller.abort()
    scan.mockRejectedValue(createAiVaultScanCancelledError())
    await expect(
      scanRelayAiVaultWithinBudget({ ...args, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    scan.mockRejectedValue(new Error('permission denied'))
    await expect(scanRelayAiVaultWithinBudget(args)).rejects.toThrow('permission denied')
  })
  it('leaves complete scan results unchanged', async () => {
    const result = { sessions: [row], issues: [], scannedAt: '2026-10-02T00:00:00Z' }
    scan.mockResolvedValue(result)
    expect(await scanRelayAiVaultWithinBudget(args)).toBe(result)
  })
  it('uses the twenty-second web budget and preserves older scoped rows in a partial result', async () => {
    vi.useFakeTimers()
    scan.mockImplementation(({ signal, onSessionParsed }) => {
      onSessionParsed({ ...row, id: 'newer', cwd: '/other', modifiedAt: '2026-10-02T12:00:00Z' })
      onSessionParsed(row)
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(createAiVaultScanCancelledError()), {
          once: true
        })
      )
    })
    const pending = scanRelayAiVaultWithinBudget({ ...args, scopePaths: ['/repo'] })
    await vi.advanceTimersByTimeAsync(20000)
    expect((await pending).sessions.map((session) => session.id)).toEqual(['newer', row.id])
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not turn cancellation during an active scan into partial success', async () => {
    const controller = new AbortController()
    scan.mockImplementation(({ signal, onSessionParsed }) => {
      onSessionParsed(row)
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(createAiVaultScanCancelledError()), {
          once: true
        })
      )
    })
    const pending = scanRelayAiVaultWithinBudget({ ...args, signal: controller.signal })
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await assertion
  })
})
