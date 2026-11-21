import type { AiVaultAgent, AiVaultScanIssue } from '../../shared/ai-vault/contracts/ai-vault-types'
import type { ExecutionHostId } from '../../shared/execution-host/execution-host'
import type { FileStat } from '../providers/types'
import { throwIfAiVaultScanCancelled } from './scan-lifecycle/ai-vault-scan-cancellation'
import { recordSessionScanIssue } from './parsing/session-scan-issues'
import type { RemoteSessionFilesystemProvider } from './remote-session-scanner-types'
import type { FileWithMtime } from './session-scanner-types'
import { errorMessage } from '../../shared/errors/error-message'
import { isMissingRemoteSessionPathError } from './transcripts/remote-session-file-stat'

export async function statRemoteSessionFile(
  provider: RemoteSessionFilesystemProvider,
  path: string,
  agent: AiVaultAgent,
  executionHostId: ExecutionHostId,
  issues: AiVaultScanIssue[],
  options?: {
    missingIsExpected?: boolean
    signal?: AbortSignal
    // Lets a caller tell a missing path from a failed stat, which both report
    // as null; the issue is recorded either way before this rethrows.
    rethrowFailures?: boolean
  }
): Promise<FileWithMtime | null> {
  try {
    throwIfAiVaultScanCancelled(options?.signal)
    const stat = await provider.stat(path)
    throwIfAiVaultScanCancelled(options?.signal)
    const mtimeMs = remoteSessionMtimeMs(stat)
    return {
      path,
      mtimeMs,
      modifiedAt: new Date(mtimeMs).toISOString(),
      sizeBytes: stat.size,
      ...(typeof stat.dev === 'number' ? { dev: stat.dev } : {}),
      ...(typeof stat.ino === 'number' ? { ino: stat.ino } : {}),
      ...(typeof stat.nlink === 'number' ? { nlink: stat.nlink } : {})
    }
  } catch (error) {
    throwIfAiVaultScanCancelled(options?.signal)
    const missing = isMissingRemoteSessionPathError(error)
    if (!options?.missingIsExpected || !missing) {
      recordSessionScanIssue(issues, {
        executionHostId,
        agent,
        path,
        message: errorMessage(error)
      })
    }
    if (options?.rethrowFailures && !missing) {
      throw error
    }
    return null
  }
}

function remoteSessionMtimeMs(stat: FileStat): number {
  if (typeof stat.mtimeMs === 'number' && Number.isFinite(stat.mtimeMs)) {
    return stat.mtimeMs
  }
  return stat.mtime > 10_000_000_000 ? stat.mtime : stat.mtime * 1000
}
