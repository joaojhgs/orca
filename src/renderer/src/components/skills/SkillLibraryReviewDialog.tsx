import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { SkillLibraryPreview } from '../../../../shared/skill-library-contract'
import { translate } from '@/i18n/i18n'

type ReviewDialogProps = {
  review: SkillLibraryPreview | null
  busy: boolean
  error: string | null
  onClose(): void
  onFile(path: string): void
  onImport(addVersion: boolean): void
  saved?: boolean
  onAssign?(): void
}

export function SkillLibraryReviewDialog(props: ReviewDialogProps) {
  const key = props.review ? `${props.review.candidate.id}:${props.review.packageDigest}` : 'closed'
  return <SkillLibraryReviewForm key={key} {...props} />
}

function SkillLibraryReviewForm(props: ReviewDialogProps) {
  const [reviewed, setReviewed] = useState(false)
  const [addVersion, setAddVersion] = useState(false)
  const id = useId()
  const review = props.review
  return (
    <Dialog
      open={review !== null}
      onOpenChange={(open) => {
        if (!open && !props.busy) {
          props.onClose()
        }
      }}
    >
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {translate('skills.library.reviewTitle', 'Review {{name}}', {
              name: review?.candidate.name
            })}
          </DialogTitle>
          <DialogDescription>
            {translate(
              props.saved ? 'skills.library.savedReviewHelp' : 'skills.library.reviewHelp',
              props.saved
                ? 'This is the imported immutable snapshot, not the source folder. Assign it to runtimes to provision its files.'
                : 'All listed files enter the local library, including scripts and assets. Nothing is executed during import. Check for secrets and unwanted instructions.'
            )}
          </DialogDescription>
        </DialogHeader>
        {review ? (
          <>
            <Label htmlFor={`${id}-file`}>
              {translate('skills.library.includedFiles', 'Included files ({{total}})', {
                total: review.files.length
              })}
            </Label>
            <Select value={review.filePath} disabled={props.busy} onValueChange={props.onFile}>
              <SelectTrigger id={`${id}-file`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {review.files.map((file) => (
                    <SelectItem key={file.path} value={file.path}>
                      {file.path} ·{' '}
                      {translate('skills.library.bytes', '{{total}} bytes', { total: file.size })}
                      {file.executable
                        ? translate('skills.library.executable', ' · executable')
                        : ''}
                      {file.classification === 'binary'
                        ? translate('skills.library.binary', ' · binary')
                        : ''}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <pre className="scrollbar-sleek min-h-0 overflow-auto rounded-md border border-border p-3 font-mono text-xs whitespace-pre-wrap break-words">
              {review.content ??
                translate(
                  'skills.library.binaryPreview',
                  'Binary or large file: contents are not rendered. The file is still included in the snapshot.'
                )}
              {review.truncated && review.content
                ? `\n${translate('skills.library.truncated', '[Preview truncated]')}`
                : ''}
            </pre>
            {!props.saved ? (
              <fieldset className="flex flex-col gap-3" disabled={props.busy}>
                <legend className="sr-only">
                  {translate('skills.library.importApproval', 'Import approval')}
                </legend>
                <Label htmlFor={`${id}-reviewed`}>
                  <Checkbox
                    id={`${id}-reviewed`}
                    checked={reviewed}
                    onCheckedChange={(value) => setReviewed(value === true)}
                  />
                  {translate(
                    'skills.library.reviewed',
                    'I reviewed the files and want to import this snapshot.'
                  )}
                </Label>
                <Label htmlFor={`${id}-version`}>
                  <Checkbox
                    id={`${id}-version`}
                    checked={addVersion}
                    onCheckedChange={(value) => setAddVersion(value === true)}
                  />
                  {translate(
                    'skills.library.allowVersion',
                    'Allow a new version if this name already has different content.'
                  )}
                </Label>
              </fieldset>
            ) : null}
          </>
        ) : null}
        {props.error ? (
          <p role="alert" className="text-xs text-destructive">
            {props.error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={props.busy} onClick={props.onClose}>
            {translate('skills.library.cancel', 'Cancel')}
          </Button>
          <Button
            disabled={(!props.saved && !reviewed) || props.busy}
            onClick={() => (props.saved ? props.onAssign?.() : props.onImport(addVersion))}
          >
            {props.busy
              ? translate('skills.library.working', 'Working…')
              : props.saved
                ? translate('skills.library.assign', 'Assign')
                : translate('skills.library.import', 'Import into local library')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
