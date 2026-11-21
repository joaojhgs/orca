import { requireSshFilesystemProvider } from '../../providers/ssh-filesystem-dispatch'
import { MAX_FILE_RANGE_READ_BYTES } from '../../../shared/file-content/file-range-read'
import type { SshTranscriptLocation } from './ssh-transcript-path'

export type SshTranscriptHandle = { sshTranscript: SshTranscriptLocation }

export async function statSshTranscript(location: SshTranscriptLocation): Promise<{
  size: number
  mtimeMs: number
  ctimeMs: number
  dev: number
  ino: number
}> {
  const stat = await requireSshFilesystemProvider(location.connectionId).stat(location.remotePath)
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs ?? stat.mtime,
    ctimeMs: stat.ctimeMs ?? 0,
    dev: stat.dev ?? 0,
    ino: stat.ino ?? 0
  }
}

export async function readSshTranscript(
  handle: SshTranscriptHandle,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number,
  signal?: AbortSignal
): Promise<{ bytesRead: number; buffer: Buffer }> {
  const { connectionId, remotePath } = handle.sshTranscript
  const provider = requireSshFilesystemProvider(connectionId)
  if (!provider.readFileRange) {
    throw new Error('Remote transcript reads require ranged file access. Update the SSH relay.')
  }
  let bytesRead = 0
  while (bytesRead < length) {
    signal?.throwIfAborted()
    const count = Math.min(length - bytesRead, MAX_FILE_RANGE_READ_BYTES)
    const result = await provider.readFileRange(remotePath, position + bytesRead, count, { signal })
    result.bytes.copy(buffer, offset + bytesRead)
    bytesRead += result.bytesRead
    if (result.bytesRead < count) {
      break
    }
  }
  return { bytesRead, buffer }
}
