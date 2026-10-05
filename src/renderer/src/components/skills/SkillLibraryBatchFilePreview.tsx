import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { SkillLibraryPreview } from '../../../../shared/skill-library-contract'
import { candidateSelectionKey, type ReviewedHostSkill } from './skill-library-batch-import'

export function SkillLibraryBatchSelector(props: {
  reviews: ReviewedHostSkill[]
  active: number
  busy: boolean
  onSelect(index: number): void
}) {
  return (
    <Select
      value={String(props.active)}
      disabled={props.busy}
      onValueChange={(value) => props.onSelect(Number(value))}
    >
      <SelectTrigger aria-label={translate('skills.library.reviewSkill', 'Skill to review')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {props.reviews.map((row, index) => (
            <SelectItem key={candidateSelectionKey(row.source)} value={String(index)}>
              {row.source.name} · {row.source.hostLabel} · {row.preview.files.length} files
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function SkillLibraryBatchFilePreview(props: {
  preview: SkillLibraryPreview
  busy: boolean
  onFile(path: string): void
}) {
  return (
    <>
      <Select value={props.preview.filePath} disabled={props.busy} onValueChange={props.onFile}>
        <SelectTrigger
          aria-label={translate('skills.library.reviewFile', 'Included file to review')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {props.preview.files.map((row) => (
              <SelectItem key={row.path} value={row.path}>
                {row.path} · {row.size} bytes{row.executable ? ' · executable' : ''}
                {row.classification === 'binary' ? ' · binary' : ''}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <pre className="scrollbar-sleek min-h-0 overflow-auto rounded-md border border-border p-3 font-mono text-xs whitespace-pre-wrap break-words">
        {props.preview.content ??
          translate(
            'skills.library.binaryPreview',
            'Binary or large file: contents are not rendered. The file is still included in the snapshot.'
          )}
        {props.preview.truncated ? '\n[Preview truncated]' : ''}
      </pre>
    </>
  )
}
