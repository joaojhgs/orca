import type { PendingEditorReveal } from '@/store/slices/editor/types/pending-editor-reveal'
import type { OpenFile } from '@/store/slices/editor/types/open-file'

export function matchesPendingEditorReveal(
  reveal: PendingEditorReveal | null,
  file: Pick<OpenFile, 'id' | 'filePath'>,
  viewStateId: string
): reveal is PendingEditorReveal {
  if (!reveal || (reveal.viewStateId && reveal.viewStateId !== viewStateId)) {
    return false
  }
  return reveal.fileId ? reveal.fileId === file.id : reveal.filePath === file.filePath
}
