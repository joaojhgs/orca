import {
  ARTIFACT_MAX_CONTENT_BYTES,
  type ArtifactWriteRequest
} from '../../../../../shared/artifacts/artifacts'
import {
  fileArtifactSourceKey,
  type FileArtifactOwner
} from '@/lib/files/artifacts/file-artifact-source-key'
import { ArtifactPublishPreparationError } from '@/components/artifacts/artifact-publish-flow'
import { readOrcaMediaRange } from '@/runtime/files/reads/orca-media-range-read'
import { bytesToBase64 } from '@/runtime/files/reads/runtime-paged-file-read'
import { basename } from '@/lib/path'
import { useAppStore } from '@/store/index'
import type { OpenFile } from '@/store/slices/editor/types/open-file'
import { flushPendingEditorBuffer } from '../save/flush/editor-pending-flush'

export type ShareableFileContentType = ArtifactWriteRequest['contentType']

/** Use captured file ownership; legacy tabs without routes retain their recorded runtime environment. */
function editorArtifactOwner(file: OpenFile): FileArtifactOwner {
  const route = file.operationProvenance?.generation.route
  return {
    executionHostId: route?.executionHostId ?? null,
    runtimeEnvironmentId: route ? route.runtimeEnvironmentId : (file.runtimeEnvironmentId ?? null),
    externalSshTargetId: file.externalSshTargetId
  }
}

export function editorArtifactSourceKey(file: OpenFile): string {
  return fileArtifactSourceKey(editorArtifactOwner(file), file.filePath)
}

export function editorArtifactContentType(
  filePath: string,
  isMarkdown: boolean
): ShareableFileContentType | null {
  if (isMarkdown) {
    return 'text/markdown'
  }
  if (/\.pdf$/i.test(filePath)) {
    return 'application/pdf'
  }
  return isShareableHtmlPath(filePath) ? 'text/html' : null
}

export function isShareableHtmlPath(filePath: string): boolean {
  return /\.html?$/i.test(filePath)
}

export function createEditorArtifactRequest(
  file: OpenFile,
  content: string,
  contentType: ShareableFileContentType
): ArtifactWriteRequest {
  return {
    sourceKey: editorArtifactSourceKey(file),
    content,
    contentType,
    fileName: basename(file.filePath)
  }
}

export function createCurrentEditorArtifactRequest(
  file: OpenFile,
  contentFileId: string,
  fallbackContent: string,
  contentType: ShareableFileContentType
): ArtifactWriteRequest {
  flushPendingEditorBuffer(useAppStore.getState(), contentFileId)
  const content = useAppStore.getState().editorDrafts[contentFileId] ?? fallbackContent
  return createEditorArtifactRequest(file, content, contentType)
}

export async function readPdfArtifactContent(preview: {
  content: string
  mediaUrl?: string
  size?: number
}): Promise<string> {
  if (!preview.mediaUrl) {
    return preview.content
  }
  if (!preview.size || !Number.isSafeInteger(preview.size) || preview.size < 0) {
    throw new ArtifactPublishPreparationError('unreadable')
  }
  if (4 * Math.ceil(preview.size / 3) > ARTIFACT_MAX_CONTENT_BYTES) {
    throw new ArtifactPublishPreparationError('too-large')
  }
  try {
    const bytes = await readOrcaMediaRange(preview.mediaUrl, 0, preview.size)
    return bytesToBase64(bytes)
  } catch {
    throw new ArtifactPublishPreparationError('unreadable')
  }
}
