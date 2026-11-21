import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor/types/open-file'
import { EditorPanelHeader } from './panel/header/EditorPanelHeader'

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      activeGroupIdByWorktree: {},
      settings: {},
      updateSettings: vi.fn()
    })
}))

vi.mock('@/components/diff-comments/use-visible-worktree-diff-comments', () => ({
  useVisibleWorktreeDiffComments: () => ({ owner: null, comments: [] })
}))

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({
    children,
    delayDuration
  }: {
    children: React.ReactNode
    delayDuration: number
  }) => (
    <div data-tooltip-provider data-delay-duration={delayDuration}>
      {children}
    </div>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <span data-tooltip>{children}</span>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>
}))

vi.mock('./panel/header/EditorPanelHeaderPath', () => ({
  EditorPanelHeaderPath: () => null
}))

vi.mock('./panel/header/EditorPanelActionsMenu', () => ({
  EditorPanelActionsMenu: () => null
}))

vi.mock('@/components/artifacts/ArtifactPublishButton', () => ({
  ArtifactPublishButton: () => <button data-artifact-publish />
}))

vi.mock('./diff/review/diff-navigation-context', () => ({
  useDiffNavigation: () => ({
    changeCount: 2,
    goToPreviousDiff: vi.fn(),
    goToNextDiff: vi.fn()
  })
}))

const activeFile: OpenFile = {
  id: 'diff:/repo/file.ts',
  filePath: '/repo/file.ts',
  relativePath: 'file.ts',
  worktreeId: 'repo::/repo',
  language: 'typescript',
  isDirty: false,
  mode: 'diff'
}

const baseProps = {
  activeFile,
  copiedPathVisible: false,
  isSingleDiff: false,
  isDiffSurface: true,
  isMarkdown: false,
  isCsv: false,
  isNotebook: false,
  hasEditorToggle: false,
  availableEditorToggleModes: [],
  effectiveToggleValue: 'edit',
  canOpenPreview: false,
  canShowMarkdownPreview: false,
  canShowMarkdownTableOfContents: false,
  isMarkdownTableOfContentsDisabled: false,
  shouldShowMarkdownExportAction: false,
  canExportMarkdownToPdf: false,
  showMarkdownTableOfContents: false,
  canShowMarkdownFrontmatterToggle: false,
  markdownFrontmatterVisible: false,
  sideBySide: false,
  openFileState: { canOpen: false },
  onCopyPath: vi.fn(),
  onOpenDiffTargetFile: vi.fn(),
  onOpenPreview: vi.fn(),
  onOpenMarkdownPreview: vi.fn(),
  onToggleSideBySide: vi.fn(),
  onEditorToggleChange: vi.fn(),
  onToggleMarkdownTableOfContents: vi.fn(),
  onToggleMarkdownFrontmatter: vi.fn(),
  onExportMarkdownToPdf: vi.fn()
} satisfies ComponentProps<typeof EditorPanelHeader>

function renderHeader(overrides: Partial<ComponentProps<typeof EditorPanelHeader>> = {}): string {
  return renderToStaticMarkup(<EditorPanelHeader {...baseProps} {...overrides} />)
}

describe('EditorPanelHeader', () => {
  it('offers PDF sharing on file tabs, never on diff surfaces', () => {
    const props = {
      activeFile: { ...activeFile, filePath: '/repo/report.pdf', mode: 'edit' as const },
      createArtifactRequest: vi.fn(),
      isDiffSurface: false
    }
    expect(renderHeader(props)).toContain('data-artifact-publish="true"')
    expect(renderHeader({ ...props, isDiffSurface: true })).not.toContain('data-artifact-publish')
  })
})
