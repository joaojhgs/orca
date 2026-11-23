import { defineMethod } from '../../core'
import {
  filePreviewForPath,
  isDocumentPreview
} from '../../../../../shared/file-preview/file-preview-kind'
import { mintWebFilePreview } from '../../../../media/web-file-preview'

import { WebFilePreview } from '../../../../../shared/rpc-contract/filesystem/files-web-preview-params'

export const FILE_WEB_PREVIEW_METHODS = [
  defineMethod({
    name: 'files.previewUrl',
    permission: 'workspace',
    params: WebFilePreview,
    handler: async (params, { runtime, connectionId, clientId }) => {
      if (!connectionId) {
        throw new Error('Connected browser required')
      }
      const preview = filePreviewForPath(
        'grantId' in params ? params.absolutePath : params.relativePath
      )
      if (!preview || preview.kind === 'image') {
        throw new Error('Unsupported preview type')
      }
      const source =
        'grantId' in params
          ? {
              stat: () =>
                runtime.statTerminalArtifact(
                  params.worktree,
                  params.grantId,
                  params.absolutePath,
                  clientId
                ),
              read: (offset: number, length: number) =>
                runtime.readTerminalArtifactChunk(
                  params.worktree,
                  params.grantId,
                  params.absolutePath,
                  offset,
                  length,
                  clientId
                )
            }
          : {
              stat: () => runtime.statRuntimeFile(params.worktree, params.relativePath),
              read: (offset: number, length: number) =>
                runtime.readFileExplorerChunk(params.worktree, params.relativePath, offset, length)
            }
      return {
        ...(await mintWebFilePreview(connectionId, source, preview.mimeType)),
        ...(isDocumentPreview(preview) ? { isImage: true } : {})
      }
    }
  })
]
