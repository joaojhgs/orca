import { useState } from 'react'
import {
  SkillLibraryBatchFilePreview,
  SkillLibraryBatchSelector
} from './SkillLibraryBatchFilePreview'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { SkillLibraryPreviewSchema } from '../../../../shared/skill-library-contract'
import { translate } from '@/i18n/i18n'
import type { HostedSkillCandidate } from './skill-library-host-discovery'
import type { useSkillLibrary } from './use-skill-library'
import {
  candidateSelectionKey,
  importSkillBatch,
  reviewSkillBatch,
  type ReviewedHostSkill
} from './skill-library-batch-import'

export function SkillLibraryBulkImport(props: {
  candidates: HostedSkillCandidate[]
  library: ReturnType<typeof useSkillLibrary>
  onPreview(candidate: HostedSkillCandidate): void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [reviews, setReviews] = useState<ReviewedHostSkill[]>([])
  const [active, setActive] = useState(0)
  const [reviewed, setReviewed] = useState(false)
  const [addVersion, setAddVersion] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const choose = (key: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (checked && next.size < 50) {
        next.add(key)
      } else if (!checked) {
        next.delete(key)
      }
      return next
    })
  const startReview = async () => {
    setNotice(null)
    const batch = await props.library.run((target) =>
      reviewSkillBatch(
        target,
        props.candidates.filter((row) => selected.has(candidateSelectionKey(row)))
      )
    )
    if (batch) {
      setReviews(batch)
      setActive(0)
      setReviewed(false)
      setAddVersion(false)
    }
  }
  const importReviewed = async () => {
    if (!reviewed) {
      return
    }
    const result = await props.library.run((target) =>
      importSkillBatch(target, reviews, addVersion)
    )
    if (!result) {
      return
    }
    const successful = new Set(
      result
        .filter((row) => row.status === 'imported' || row.status === 'unchanged')
        .map((row) => row.key)
    )
    setReviews((current) =>
      current.filter((row) => !successful.has(candidateSelectionKey(row.source)))
    )
    setSelected((current) => new Set([...current].filter((key) => !successful.has(key))))
    setActive(0)
    setReviewed(false)
    setNotice(
      result
        .map((row) => `${row.name}: ${row.status}${row.message ? ` — ${row.message}` : ''}`)
        .join(' · ')
    )
    await props.library.refresh()
  }
  const current = reviews[active]
  const file = async (filePath: string) => {
    if (!current) {
      return
    }
    const result = await props.library.run(async (target) =>
      SkillLibraryPreviewSchema.parse(
        await callRuntimeRpc(
          target,
          'skills.library.preview',
          {
            hostId: current.source.hostId,
            candidateId: current.source.id,
            filePath
          },
          { timeoutMs: 120000 }
        )
      )
    )
    if (result) {
      setReviews((rows) => rows.map((row) => (row === current ? { ...row, preview: result } : row)))
      if (result.packageDigest !== current.preview.packageDigest) {
        setReviewed(false)
      }
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={props.library.busy || !props.candidates.length}
          onClick={() =>
            setSelected(new Set(props.candidates.slice(0, 50).map(candidateSelectionKey)))
          }
        >
          {translate('skills.library.selectAllImport', 'Select all (up to 50)')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={props.library.busy || !selected.size}
          onClick={() => setSelected(new Set())}
        >
          {translate('skills.library.clearImport', 'Clear selection')}
        </Button>
        <Button
          size="sm"
          disabled={props.library.busy || !selected.size}
          onClick={() => void startReview()}
        >
          {props.library.busy
            ? translate('skills.library.preparingBatch', 'Preparing snapshots…')
            : translate('skills.library.reviewBatch', 'Review and import {{total}} skills', {
                total: selected.size
              })}
        </Button>
      </div>
      <fieldset disabled={props.library.busy} className="flex flex-col gap-2">
        <legend className="sr-only">
          {translate('skills.library.batchSelection', 'Skills to import')}
        </legend>
        {props.candidates.map((row) => (
          <div key={candidateSelectionKey(row)} className="flex items-start justify-between gap-3">
            <Label className="min-w-0 items-start">
              <Checkbox
                aria-label={translate('skills.library.selectSkill', 'Select {{name}} on {{host}}', {
                  name: row.name,
                  host: row.hostLabel
                })}
                checked={selected.has(candidateSelectionKey(row))}
                disabled={!selected.has(candidateSelectionKey(row)) && selected.size >= 50}
                onCheckedChange={(value) => choose(candidateSelectionKey(row), value === true)}
              />
              <span className="min-w-0 flex flex-col gap-1">
                <span>{row.name}</span>
                <span className="text-xs text-muted-foreground">
                  {row.hostLabel} · {row.sourceLabel}
                </span>
                {row.description ? (
                  <span className="text-xs text-muted-foreground">{row.description}</span>
                ) : null}
              </span>
            </Label>
            <Button
              variant="outline"
              size="sm"
              disabled={props.library.busy}
              onClick={() => props.onPreview(row)}
            >
              {translate('skills.library.reviewImport', 'Review import')}
            </Button>
          </div>
        ))}
      </fieldset>
      {notice ? (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
      <Dialog
        open={reviews.length > 0}
        onOpenChange={(open) => {
          if (!open && !props.library.busy) {
            setReviews([])
          }
        }}
      >
        <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {translate('skills.library.reviewBatchTitle', 'Review {{total}} skill snapshots', {
                total: reviews.length
              })}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'skills.library.reviewBatchHelp',
                'One approval imports all selected snapshots. Every listed file is included, including scripts and assets; nothing is executed. Check for secrets and unwanted instructions. Existing assignments stay unchanged.'
              )}
            </DialogDescription>
          </DialogHeader>
          {current ? (
            <>
              <SkillLibraryBatchSelector
                reviews={reviews}
                active={active}
                busy={props.library.busy}
                onSelect={setActive}
              />
              <SkillLibraryBatchFilePreview
                preview={current.preview}
                busy={props.library.busy}
                onFile={(value) => void file(value)}
              />
              <fieldset className="flex flex-col gap-3" disabled={props.library.busy}>
                <legend className="sr-only">
                  {translate('skills.library.importApproval', 'Import approval')}
                </legend>
                <Label>
                  <Checkbox
                    checked={reviewed}
                    onCheckedChange={(value) => setReviewed(value === true)}
                  />
                  {translate(
                    'skills.library.reviewedBatch',
                    'I reviewed the selected snapshots and want to import them all.'
                  )}
                </Label>
                <Label>
                  <Checkbox
                    checked={addVersion}
                    onCheckedChange={(value) => setAddVersion(value === true)}
                  />
                  {translate(
                    'skills.library.allowVersion',
                    'Allow a new version if this name already has different content.'
                  )}
                </Label>
              </fieldset>
            </>
          ) : null}
          {props.library.error ? (
            <p role="alert" className="text-xs text-destructive">
              {props.library.error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-xs text-muted-foreground">
              {notice}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" disabled={props.library.busy} onClick={() => setReviews([])}>
              {translate('skills.library.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={props.library.busy || !reviewed}
              onClick={() => void importReviewed()}
            >
              {props.library.busy
                ? translate('skills.library.importingBatch', 'Importing snapshots…')
                : translate('skills.library.importBatch', 'Import {{total}} skills', {
                    total: reviews.length
                  })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
