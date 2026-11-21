import { useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'
import type { SkillLibraryVersion } from '../../../../shared/skill-library-contract'
import { SkillSharePublishedLink } from './sharing/SkillShareReviewContent'
import { SkillLibraryVersionSelection } from './SkillLibraryVersionSelection'
import { libraryVersionPlugins } from '../../../../shared/skill-library-plugin'

type SkillLibraryShareProps = {
  versions: SkillLibraryVersion[]
  busy: boolean
  error: string | null
  onClose(): void
  onPublish(
    bundleName: string,
    versions?: SkillLibraryVersion[]
  ): Promise<{ url: string; packageDigest: string } | null>
  onManageLinks(): void
}
export function SkillLibraryShareDialog(props: SkillLibraryShareProps) {
  return (
    <SkillLibraryShareForm
      key={props.versions.map((version) => version.versionId).join(':') || 'closed'}
      {...props}
    />
  )
}
function SkillLibraryShareForm(props: SkillLibraryShareProps) {
  const t = useTranslate()
  const [reviewed, setReviewed] = useState(false)
  const [selected, setSelected] = useState(new Set(props.versions.map((row) => row.versionId)))
  const versions = props.versions.filter((row) => selected.has(row.versionId))
  const plugin = props.versions[0] && libraryVersionPlugins(props.versions[0])[0]
  const [bundleName, setBundleName] = useState(
    plugin && /^[a-z0-9][a-z0-9-]{0,63}$/.test(plugin.name)
      ? plugin.name
      : props.versions.length === 1
        ? props.versions[0].name
        : 'shared-skills'
  )
  const [share, setShare] = useState<{ url: string; packageDigest: string } | null>(null)
  const validName = /^[a-z0-9][a-z0-9-]{0,63}$/.test(bundleName)
  return (
    <Dialog
      open={props.versions.length > 0}
      onOpenChange={(open) => !open && !props.busy && props.onClose()}
    >
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t('skills.library.shareTitle', 'Share imported skills')}</DialogTitle>
          <DialogDescription>
            {t(
              'skills.library.localShareHelp',
              'Host a pinned copy on this Orca server, like local artifacts. Anyone who can reach the server and has the link can download all included files. No Cloud upload.'
            )}
          </DialogDescription>
        </DialogHeader>
        {share ? (
          <SkillSharePublishedLink
            shareUrl={share.url}
            packageDigest={share.packageDigest}
            onCopy={() => void window.api.ui.writeClipboardText(share.url)}
            onManageLinks={props.onManageLinks}
          />
        ) : (
          <div className="scrollbar-sleek flex min-h-0 flex-col gap-4 overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="library-share-name">
                {t('skills.library.bundleName', 'Bundle name')}
              </Label>
              <Input
                id="library-share-name"
                value={bundleName}
                onChange={(event) => setBundleName(event.target.value)}
                disabled={props.busy}
                aria-invalid={!validName}
              />
            </div>
            <SkillLibraryVersionSelection
              versions={props.versions}
              selected={selected}
              disabled={props.busy}
              onChange={(value) => {
                setSelected(value)
                setReviewed(false)
              }}
            />
            <div className="flex items-start gap-2">
              <Checkbox
                id="library-share-reviewed"
                aria-label={t('skills.library.approveShare', 'Approve sharing selected skills')}
                checked={reviewed}
                onCheckedChange={(value) => setReviewed(value === true)}
                disabled={props.busy}
              />
              <Label htmlFor="library-share-reviewed">
                {t(
                  'skills.library.shareReviewed',
                  'I reviewed these imported snapshots for secrets, instructions and scripts, and want to share every included file.'
                )}
              </Label>
            </div>
          </div>
        )}
        {props.error ? (
          <p role="alert" className="text-xs text-destructive">
            {props.error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={props.busy} onClick={props.onClose}>
            {share ? t('skills.library.done', 'Done') : t('skills.library.cancel', 'Cancel')}
          </Button>
          {!share ? (
            <Button
              disabled={
                !reviewed || !validName || props.busy || !versions.length || versions.length > 50
              }
              onClick={() =>
                void props.onPublish(bundleName, versions).then((value) => value && setShare(value))
              }
            >
              {props.busy
                ? t('skills.library.publishing', 'Publishing…')
                : t('skills.library.createLocalLink', 'Create local share link')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
