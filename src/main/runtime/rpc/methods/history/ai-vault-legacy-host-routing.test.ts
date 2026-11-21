import '../../dispatch/testing/unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../../dispatcher'
import type { RpcRequest } from '../../core'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import type {
  AiVaultListResult,
  AiVaultSession
} from '../../../../../shared/ai-vault/contracts/ai-vault-types'
import { AiVaultListSessionsParams } from '../../../../../shared/rpc-contract/ai-vault/ai-vault-params'
import { AI_VAULT_METHODS } from './ai-vault'

const SCANNED_AT = '2026-06-29T00:00:00.000Z'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

function makeResult(): AiVaultListResult {
  return { sessions: [], issues: [], scannedAt: SCANNED_AT }
}

function makeSession(): AiVaultSession {
  return {
    id: 'local:claude:sess-1:/tmp/t.jsonl',
    executionHostId: 'local',
    agent: 'claude',
    sessionId: 'sess-1',
    title: 'Test session',
    cwd: '/tmp',
    branch: null,
    model: null,
    filePath: '/tmp/t.jsonl',
    codexHome: null,
    createdAt: null,
    updatedAt: null,
    modifiedAt: SCANNED_AT,
    messageCount: 2,
    totalTokens: 0,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: 'claude --resume sess-1',
    subagent: null
  }
}

function makeDispatcher(
  overrides: Partial<
    Pick<OrcaRuntimeService, 'listAiVaultSessions' | 'prepareAiVaultSessionResume'>
  > = {}
): RpcDispatcher {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This explicit-registry fixture provides every runtime method exercised by the two host-routing requests.
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    ensureStructuredAgentSessionHost: async () => undefined,
    listAiVaultSessions: async () => makeResult(),
    ...overrides
  } as unknown as OrcaRuntimeService
  return new RpcDispatcher({ runtime, methods: AI_VAULT_METHODS })
}

describe('aiVault SSH ownership', () => {
  it('does not materialize an SSH transcript on the Orca server', async () => {
    const prepareAiVaultSessionResume = async () => {
      throw new Error('Local preparation must not run for SSH')
    }
    const dispatcher = makeDispatcher({ prepareAiVaultSessionResume })
    expect(
      await dispatcher.dispatch(
        makeRequest('aiVault.prepareSessionResume', {
          agent: 'codex',
          executionHostId: 'ssh:personal',
          filePath: '/remote/session.jsonl',
          codexHome: null
        })
      )
    ).toMatchObject({ ok: true, result: { useRealCodexHome: false } })
  })
  it('forwards host scope and restamps only the local leg of an aggregate', async () => {
    const remote = {
      ...makeSession(),
      id: 'ssh:personal:session',
      executionHostId: 'ssh:personal' as const
    }
    const list = vi.fn().mockResolvedValue({ ...makeResult(), sessions: [makeSession(), remote] })
    const dispatcher = makeDispatcher({ listAiVaultSessions: list })
    expect(
      await dispatcher.dispatch(
        makeRequest('aiVault.listSessions', {
          executionHostScope: 'all',
          executionHostId: 'runtime:browser'
        })
      )
    ).toMatchObject({
      ok: true,
      result: {
        sessions: [
          { executionHostId: 'runtime:browser' },
          { id: remote.id, executionHostId: 'ssh:personal' }
        ]
      }
    })
    expect(list.mock.calls[0]?.[0]).toMatchObject({ executionHostScope: 'all' })
    expect(AiVaultListSessionsParams.safeParse({ executionHostScope: 'invalid' }).success).toBe(
      false
    )
    expect(
      AiVaultListSessionsParams.safeParse({ executionHostScope: 'ssh:personal' }).success
    ).toBe(true)
  })
})
