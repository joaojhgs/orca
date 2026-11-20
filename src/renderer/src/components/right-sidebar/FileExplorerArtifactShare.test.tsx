// @vitest-environment happy-dom
import { render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import type { ArtifactWriteRequest } from '../../../../shared/artifacts'
import type { TreeNode } from './file-explorer-types'

const mocks = vi.hoisted<{
  read: ReturnType<typeof vi.fn>
  request: (() => Promise<ArtifactWriteRequest>) | null
  state: { activeWorktreeId: string; worktreesByRepo: Record<string, never>; openFiles: [] }
}>(() => ({
  read: vi.fn(),
  request: null,
  state: { activeWorktreeId: 'workspace', worktreesByRepo: {}, openFiles: [] }
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('@/runtime/runtime-file-client', () => ({ readRuntimeFilePreview: mocks.read }))
vi.mock('@/components/artifacts/ArtifactPublishButton', () => ({
  ArtifactPublishButton: (props: { createRequest: () => Promise<ArtifactWriteRequest> }) => {
    mocks.request = props.createRequest
    return null
  }
}))
import { explorerArtifactSourceKey, FileExplorerArtifactShare } from './FileExplorerArtifactShare'

const node: TreeNode = {
  name: 'report.md',
  path: '/repo/report.md',
  relativePath: 'report.md',
  isDirectory: false,
  depth: 0,
  operationOwner: { kind: 'ssh', connectionId: 'desktop' }
}

describe('explorer artifact sharing ownership', () => {
  beforeEach(() => {
    mocks.read.mockReset()
    mocks.request = null
  })
  afterEach(cleanup)
  it('reads the captured SSH owner and retains its provenance', async () => {
    mocks.read.mockResolvedValue({ content: '# Report', isBinary: false })
    render(
      <FileExplorerArtifactShare
        node={node}
        connectionId="desktop"
        workspaceId="workspace"
        anchorRef={createRef()}
        onOpenChange={vi.fn()}
      />
    )
    expect(await mocks.request?.()).toEqual({
      sourceKey: JSON.stringify(['ssh', 'desktop', '/repo/report.md']),
      content: '# Report',
      contentType: 'text/markdown',
      fileName: 'report.md'
    })
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'desktop', worktreeId: 'workspace' }),
      node.path
    )
  })
  it('does not read from another SSH owner', async () => {
    render(
      <FileExplorerArtifactShare
        node={node}
        connectionId="other"
        anchorRef={createRef()}
        onOpenChange={vi.fn()}
      />
    )
    await expect(mocks.request?.()).rejects.toThrow('unreadable')
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('does not fall through to local reads for a remote runtime without its captured context', async () => {
    render(
      <FileExplorerArtifactShare
        node={{
          ...node,
          operationOwner: { kind: 'runtime', environmentId: 'remote', executionHostId: 'local' }
        }}
        anchorRef={createRef()}
        onOpenChange={vi.fn()}
      />
    )
    await expect(mocks.request?.()).rejects.toThrow('unreadable')
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('keeps PDFs base64 and rejects binary text', async () => {
    mocks.read.mockResolvedValue({ content: 'JVBERi0=', isBinary: true })
    const view = render(
      <FileExplorerArtifactShare
        node={{ ...node, name: 'report.pdf', path: '/repo/report.pdf' }}
        connectionId="desktop"
        anchorRef={createRef()}
        onOpenChange={vi.fn()}
      />
    )
    expect(await mocks.request?.()).toMatchObject({
      contentType: 'application/pdf',
      content: 'JVBERi0='
    })
    view.unmount()
    render(
      <FileExplorerArtifactShare
        node={node}
        connectionId="desktop"
        anchorRef={createRef()}
        onOpenChange={vi.fn()}
      />
    )
    await expect(mocks.request?.()).rejects.toThrow('binary')
  })
  it('rejects unresolved owners', () => {
    expect(() =>
      explorerArtifactSourceKey({ ...node, operationOwner: { kind: 'unresolved' } })
    ).toThrow('unreadable')
  })
})
