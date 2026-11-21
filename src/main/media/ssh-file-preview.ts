import {
  filePreviewForPath,
  isDocumentPreview,
  streamsPreviewByRange,
  type FilePreview
} from '../../shared/file-preview/file-preview-kind'
import { readSshFileRange } from '../ipc/filesystem/reads/ssh-file-range'
import { abortWhenRendererGone } from '../ipc/renderer-requests/renderer-lifetime-abort'
import type { Store } from '../persistence/loading-store/store'
import { FileRangeReadUnsupportedError } from '../providers/filesystem-provider-contract'
import { requireSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import {
  DOCUMENT_SIGNATURE_PROBE_BYTES,
  prefixFitsDocumentPreview
} from './preview-document-signature'
import {
  assertPreviewableRasterHeader,
  incrementalPrefixReader
} from './preview-raster-header-check'
import {
  mintPreviewUrl,
  type PreviewSender,
  type PreviewUrl,
  type SshPreviewTarget
} from './preview-grant-registry'

type SshPreviewFile = SshPreviewTarget['ssh']

function assertCurrentOwner(file: SshPreviewFile): void {
  if (requireSshFilesystemProvider(file.connectionId) !== file.provider) {
    throw new Error('The SSH connection changed while the file was open. Reopen the preview.')
  }
}

export async function openSshPreviewRangeReader(
  file: SshPreviewFile,
  preview: FilePreview,
  signal: AbortSignal
): Promise<{ size: number; read: (offset: number, length: number) => Promise<Uint8Array> }> {
  assertCurrentOwner(file)
  signal.throwIfAborted()
  const { provider, filePath } = file
  const { size, type } = await provider.stat(filePath)
  if (type !== 'file' || !Number.isSafeInteger(size) || size < 0) {
    throw new Error('SSH preview requires a regular file')
  }
  if (isDocumentPreview(preview)) {
    const resolved = await provider.realpath(filePath)
    if (filePreviewForPath(resolved)?.mimeType !== preview.mimeType) {
      throw new Error('The SSH preview target changed')
    }
  }
  const read = async (offset: number, length: number) => {
    assertCurrentOwner(file)
    const bytes = await readSshFileRange(provider, filePath, size, offset, length, signal)
    assertCurrentOwner(file)
    return bytes
  }
  const readPrefix = incrementalPrefixReader(read)
  if (
    isDocumentPreview(preview) &&
    !prefixFitsDocumentPreview(preview, await readPrefix(DOCUMENT_SIGNATURE_PROBE_BYTES))
  ) {
    throw new Error('The SSH file is not the requested document type')
  }
  await assertPreviewableRasterHeader(preview, readPrefix, size)
  assertCurrentOwner(file)
  signal.throwIfAborted()
  return { size, read }
}

export async function readSshFilePreview(
  event: { sender: PreviewSender },
  file: SshPreviewFile,
  store: Store,
  options: { documents: boolean }
): Promise<PreviewUrl | null> {
  let preview = filePreviewForPath(file.filePath)
  if (!preview) {
    return null
  }
  if (streamsPreviewByRange(preview)) {
    return mintPreviewUrl(event.sender, { ssh: file }, store, preview)
  }
  if (!options.documents) {
    return null
  }
  const lifetime = abortWhenRendererGone(event.sender)
  try {
    preview = filePreviewForPath(await file.provider.realpath(file.filePath))
    if (!preview || !isDocumentPreview(preview)) {
      return null
    }
    const { size } = await openSshPreviewRangeReader(file, preview, lifetime.signal)
    return mintPreviewUrl(event.sender, { ssh: file }, store, preview, undefined, size)
  } catch (error) {
    if (error instanceof FileRangeReadUnsupportedError) {
      return null
    }
    throw error
  } finally {
    lifetime.dispose()
  }
}
