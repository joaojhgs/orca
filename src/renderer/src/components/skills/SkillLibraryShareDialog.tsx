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
import { translate } from '@/i18n/i18n'
import type { SkillLibraryVersion } from '../../../../shared/skill-library-contract'
import { SkillSharePublishedLink } from './SkillShareReviewContent'

type SkillLibraryShareProps = {
  versions: SkillLibraryVersion[]
  busy: boolean
  error: string | null
  onClose(): void
  onPublish(bundleName: string): Promise<{ url: string; packageDigest: string } | null>
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
  const [reviewed, setReviewed] = useState(false)
  const [bundleName, setBundleName] = useState(
    props.versions.length === 1 ? props.versions[0].name : 'shared-skills'
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
          <DialogTitle>
            {translate('skills.library.shareTitle', 'Share imported skills')}
          </DialogTitle>
          <DialogDescription>
            {translate(
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
                {translate('skills.library.bundleName', 'Bundle name')}
              </Label>
              <Input
                id="library-share-name"
                value={bundleName}
                onChange={(event) => setBundleName(event.target.value)}
                disabled={props.busy}
                aria-invalid={!validName}
              />
            </div>
            <ul className="flex flex-col gap-2">
              {props.versions.map((version) => (
                <li key={version.versionId}>
                  <p className="text-sm font-medium">{version.name}</p>
                  <p className="break-all text-xs text-muted-foreground">
                    {version.files.length} files ·{' '}
                    {version.files.filter((file) => file.executable).length} executable ·{' '}
                    {version.versionId}
                  </p>
                </li>
              ))}
            </ul>
            <div className="flex items-start gap-2">
              <Checkbox
                id="library-share-reviewed"
                checked={reviewed}
                onCheckedChange={(value) => setReviewed(value === true)}
                disabled={props.busy}
              />
              <Label htmlFor="library-share-reviewed">
                {translate(
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
            {share
              ? translate('skills.library.done', 'Done')
              : translate('skills.library.cancel', 'Cancel')}
          </Button>
          {!share ? (
            <Button
              disabled={!reviewed || !validName || props.busy}
              onClick={() =>
                void props.onPublish(bundleName).then((value) => value && setShare(value))
              }
            >
              {props.busy
                ? translate('skills.library.publishing', 'Publishing…')
                : translate('skills.library.createLocalLink', 'Create local share link')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
