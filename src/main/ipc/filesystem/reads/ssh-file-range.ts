import { MAX_FILE_RANGE_READ_BYTES } from '../../../../shared/file-content/file-range-read'
import {
  FileRangeReadUnsupportedError,
  type IFilesystemProvider
} from '../../../providers/filesystem-provider-contract'

export const SSH_FILE_RANGE_UPDATE_REQUIRED =
  'Reconnect the SSH target to update its Orca helper before opening this file.'

export async function readSshFileRange(
  provider: IFilesystemProvider,
  filePath: string,
  fileSize: number,
  offset: number,
  length: number,
  signal?: AbortSignal
): Promise<Buffer> {
  const readFileRange = provider.readFileRange?.bind(provider)
  if (!readFileRange) {
    throw new FileRangeReadUnsupportedError(SSH_FILE_RANGE_UPDATE_REQUIRED)
  }
  const want = Math.min(length, Math.max(0, fileSize - offset))
  const windows: Buffer[] = []
  let bytesRead = 0
  try {
    while (bytesRead < want) {
      signal?.throwIfAborted()
      const windowLength = Math.min(MAX_FILE_RANGE_READ_BYTES, want - bytesRead)
      const position = offset + bytesRead
      const window = signal
        ? await readFileRange(filePath, position, windowLength, { signal })
        : await readFileRange(filePath, position, windowLength)
      windows.push(window.bytes)
      bytesRead += window.bytesRead
      if (window.bytesRead < windowLength) {
        break
      }
    }
    signal?.throwIfAborted()
    return Buffer.concat(windows, bytesRead)
  } catch (error) {
    if (error instanceof FileRangeReadUnsupportedError) {
      throw new FileRangeReadUnsupportedError(SSH_FILE_RANGE_UPDATE_REQUIRED)
    }
    throw error
  }
}
