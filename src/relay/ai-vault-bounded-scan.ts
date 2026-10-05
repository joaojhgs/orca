import { scanRemoteAiVaultSessions } from '../main/ai-vault/remote-session-scanner'
import { ScannedSessionCollection } from '../main/ai-vault/session-root-dedup'
import { sessionSortTime } from '../main/ai-vault/session-scanner-accumulator'
import {
  requestedAiVaultSessionDepth,
  truncateAiVaultListResult
} from '../shared/ai-vault-session-depth'
import type { AiVaultListResult } from '../shared/ai-vault-types'

// Settle before the web/relay deadlines without discarding the sidecar's completed parse cache.
export async function scanRelayAiVaultWithinBudget(
  args: Parameters<typeof scanRemoteAiVaultSessions>[0],
  timeoutMs = 20000
): Promise<AiVaultListResult> {
  const progress = new ScannedSessionCollection()
  const deadline = new AbortController()
  let expired = false
  const cancel = () => deadline.abort()
  args.signal?.addEventListener('abort', cancel, { once: true })
  if (args.signal?.aborted) {
    cancel()
  }
  const timer = setTimeout(() => {
    expired = true
    deadline.abort()
  }, timeoutMs)
  try {
    return await scanRemoteAiVaultSessions({
      ...args,
      signal: deadline.signal,
      onSessionParsed: (session) => progress.add(session)
    })
  } catch (error) {
    if (
      !expired ||
      args.signal?.aborted ||
      !(error instanceof Error) ||
      error.name !== 'AbortError'
    ) {
      throw error
    }
    const rows = [...progress.values()].sort(
      (left, right) => sessionSortTime(right) - sessionSortTime(left)
    )
    return truncateAiVaultListResult(
      {
        sessions: rows,
        scannedAt: new Date().toISOString(),
        issues: [
          {
            executionHostId: args.executionHostId,
            agent: 'codex',
            kind: 'host',
            path: args.remoteHome,
            message:
              'Session history is partially scanned. Refresh to continue from cached transcripts; older sessions may be missing.'
          }
        ]
      },
      requestedAiVaultSessionDepth(args),
      args.scopePaths
    )
  } finally {
    clearTimeout(timer)
    args.signal?.removeEventListener('abort', cancel)
  }
}
