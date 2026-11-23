import type {
  RuntimeFilePreviewResult,
  RuntimeFileReadChunkResult
} from '../../../../../shared/file-content/runtime-file-read'
import type { RuntimeFileSnapshot } from '../../../runtime/files/reads/runtime-file-range-client'
import {
  pagedFilePreviewResult,
  readFileInChunks
} from '../../../runtime/files/reads/runtime-paged-file-read'
import { toRuntimeWorktreeSelector } from '../../../runtime/rpc/targets/runtime-worktree-selector'
import type { WebRuntimeResultCaller } from '../../runtime/client/web-runtime-calls'
import {
  filePreviewForPath,
  streamsPreviewByRange
} from '../../../../../shared/file-preview/file-preview-kind'
import { grantWebFilePreviewForFile } from './web-file-preview'

export async function readWebFileContent(
  file: { worktree: { id: string }; relativePath: string },
  call: WebRuntimeResultCaller,
  owner: { environmentId: string; expectedEnvironmentPairingRevision: number }
): Promise<RuntimeFilePreviewResult> {
  const address = {
    worktree: toRuntimeWorktreeSelector(file.worktree.id),
    relativePath: file.relativePath
  }
  if (
    streamsPreviewByRange(filePreviewForPath(file.relativePath)) ||
    filePreviewForPath(file.relativePath)?.kind === 'pdf'
  ) {
    return grantWebFilePreviewForFile({ ...address, ...owner })
  }
  try {
    return await call<RuntimeFilePreviewResult>('files.readPreview', address)
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'file_too_large') {
      throw error
    }
    const paged = await readFileInChunks({
      stat: () => call<RuntimeFileSnapshot>('files.stat', address),
      readChunk: (offset, length) =>
        call<RuntimeFileReadChunkResult>('files.readChunk', { ...address, offset, length })
    })
    if (paged.kind !== 'ok') {
      throw error
    }
    return pagedFilePreviewResult(file.relativePath, paged.bytes)
  }
}
