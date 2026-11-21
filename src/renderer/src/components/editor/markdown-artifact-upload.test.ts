import { describe, expect, it, vi } from 'vitest'
import type { EditorBufferViewIndex } from '@/store/slices/editor/buffers/editor-buffer-views'
import { registerPendingEditorFlush } from './save/flush/editor-pending-flush'
import type { OpenFile } from '@/store/slices/editor/types/open-file'
import {
  createCurrentMarkdownArtifactRequest,
  createMarkdownArtifactRequest,
  createPdfArtifactRequest,
  markdownArtifactSourceKey
} from './markdown-artifact-upload'

const editorState = vi.hoisted(
  (): EditorBufferViewIndex & { editorDrafts: Record<string, string> } => ({
    editorBufferIdOf: {},
    editorBufferViews: {},
    editorDrafts: {}
  })
)

vi.mock('@/store', () => ({
  useAppStore: { getState: () => editorState }
}))

function openFile(overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    id: '/repo/notes.md',
    filePath: '/repo/notes.md',
    relativePath: 'notes.md',
    worktreeId: 'worktree-1',
    language: 'markdown',
    isDirty: false,
    mode: 'edit',
    ...overrides
  }
}

describe('Markdown artifact upload', () => {
  it('preserves binary PDF content and SSH source identity', () => {
    const file = openFile({ filePath: '/repo/report.pdf', externalSshTargetId: 'personal' })
    expect(createPdfArtifactRequest(file, 'JVBERi0xLjQ=')).toEqual({
      sourceKey: JSON.stringify(['ssh', 'personal', '/repo/report.pdf']),
      fileName: 'report.pdf',
      contentType: 'application/pdf',
      content: 'JVBERi0xLjQ='
    })
  })
  it('uses the ordinary file path for local and folder workspaces', () => {
    expect(markdownArtifactSourceKey(openFile())).toBe('/repo/notes.md')
    expect(createMarkdownArtifactRequest(openFile(), '# Draft')).toEqual({
      sourceKey: '/repo/notes.md',
      content: '# Draft',
      contentType: 'text/markdown',
      fileName: 'notes.md'
    })
  })

  it('isolates source identity by runtime owner', () => {
    const file = openFile({
      runtimeEnvironmentId: 'server-1',
      operationProvenance: {
        ownershipProjection: 'explicit',
        generation: {
          route: {
            runtimeEnvironmentId: 'server-1',
            executionHostId: 'ssh:build-box'
          },
          runtimeConnectionGeneration: 1,
          runtimePairingRevision: 1,
          runtimeSshGeneration: 1,
          nestedSshGeneration: 1,
          directSshGeneration: null
        }
      }
    })
    expect(JSON.parse(markdownArtifactSourceKey(file))).toEqual([
      'ssh',
      'build-box',
      '/repo/notes.md'
    ])
  })

  it('matches the SSH CLI source identity for external files', () => {
    expect(
      JSON.parse(markdownArtifactSourceKey(openFile({ externalSshTargetId: 'build-box' })))
    ).toEqual(['ssh', 'build-box', '/repo/notes.md'])
  })

  it('flushes pending edits from another view of the Markdown buffer before sharing', () => {
    const file = openFile()
    const siblingId = 'markdown-editor-sibling'
    editorState.editorBufferIdOf = { [file.id]: 'notes-buffer', [siblingId]: 'notes-buffer' }
    editorState.editorBufferViews = { 'notes-buffer': [file.id, siblingId] }
    editorState.editorDrafts = { [file.id]: '# Older draft' }
    const unregister = registerPendingEditorFlush(siblingId, () => {
      editorState.editorDrafts[file.id] = '# Latest edit'
    })

    try {
      expect(createCurrentMarkdownArtifactRequest(file, file.id, '# Disk content').content).toBe(
        '# Latest edit'
      )
    } finally {
      unregister()
    }
  })
})
