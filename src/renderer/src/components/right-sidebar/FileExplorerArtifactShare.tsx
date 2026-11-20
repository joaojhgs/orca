import type { RefObject } from 'react'
import { ArtifactPublishButton } from '@/components/artifacts/ArtifactPublishButton'
import { ArtifactPublishPreparationError } from '@/components/artifacts/artifact-publish-flow'
import {
  markdownArtifactSourceKey,
  createCurrentMarkdownArtifactRequest
} from '@/components/editor/markdown-artifact-upload'
import {
  readRuntimeFilePreview,
  type RuntimeFileOperationArgs
} from '@/runtime/runtime-file-client'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { sshArtifactSourceKey } from '../../../../shared/artifact-cli-bridge'
import type { ArtifactWriteRequest } from '../../../../shared/artifacts'
import type { TreeNode } from './file-explorer-types'

export function explorerArtifactSourceKey(node: TreeNode, connectionId?: string | null): string {
  const owner = node.operationOwner
  if (owner?.kind === 'unresolved') {
    throw new ArtifactPublishPreparationError('unreadable')
  }
  if (owner?.kind === 'ssh') {
    return sshArtifactSourceKey(owner.connectionId, node.path)
  }
  if (owner?.kind === 'runtime') {
    if (owner.executionHostId.startsWith('ssh:')) {
      return sshArtifactSourceKey(owner.executionHostId.slice(4), node.path)
    }
    return JSON.stringify(['editor', owner.environmentId, owner.executionHostId, node.path])
  }
  return connectionId ? sshArtifactSourceKey(connectionId, node.path) : node.path
}

export function FileExplorerArtifactShare({
  node,
  connectionId,
  context,
  workspaceId,
  anchorRef,
  onOpenChange
}: {
  node: TreeNode
  connectionId?: string | null
  context?: RuntimeFileOperationArgs | null
  workspaceId?: string | null
  anchorRef: RefObject<HTMLButtonElement | null>
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const sourceKey = explorerArtifactSourceKey(node, connectionId)
  const isMarkdown = /\.(md|markdown|mdown)$/i.test(node.path)
  const createRequest = async (): Promise<ArtifactWriteRequest> => {
    const owner = node.operationOwner
    if (
      owner?.kind === 'runtime' &&
      (!context || context.settings?.activeRuntimeEnvironmentId !== owner.environmentId)
    ) {
      throw new ArtifactPublishPreparationError('unreadable')
    }
    if (owner?.kind === 'ssh' && connectionId && owner.connectionId !== connectionId) {
      throw new ArtifactPublishPreparationError('unreadable')
    }
    const state = useAppStore.getState()
    const worktreeId = workspaceId ?? context?.worktreeId ?? state.activeWorktreeId
    const worktree = worktreeId ? findWorktreeById(state.worktreesByRepo, worktreeId) : null
    const readContext = context ?? {
      settings: undefined,
      worktreeId,
      worktreePath: worktree?.path,
      connectionId: owner?.kind === 'ssh' ? owner.connectionId : (connectionId ?? undefined)
    }
    const result = await readRuntimeFilePreview(readContext, node.path)
    const pdf = node.path.toLowerCase().endsWith('.pdf')
    if (result.isBinary && !pdf) {
      throw new ArtifactPublishPreparationError('binary')
    }
    const openFile = state.openFiles.find(
      (file) => file.worktreeId === worktreeId && markdownArtifactSourceKey(file) === sourceKey
    )
    if (isMarkdown && openFile) {
      return createCurrentMarkdownArtifactRequest(
        openFile,
        openFile.markdownPreviewSourceFileId ?? openFile.id,
        result.content
      )
    }
    return {
      sourceKey,
      content: result.content,
      contentType: pdf ? 'application/pdf' : isMarkdown ? 'text/markdown' : 'text/html',
      fileName: node.name
    }
  }
  return (
    <ArtifactPublishButton
      sourceKey={sourceKey}
      createRequest={createRequest}
      isMarkdown={isMarkdown}
      anchorRef={anchorRef}
      open
      onOpenChange={onOpenChange}
    />
  )
}
