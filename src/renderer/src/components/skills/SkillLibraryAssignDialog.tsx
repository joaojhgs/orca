import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import type {
  SkillAssignmentBatchProgress,
  SkillAssignmentBatchResult
} from './skill-library-batch-assign'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { SkillInstallAgentPicker } from './SkillInstallAgentPicker'
import { SkillInstallWorkspaceCombobox } from './SkillInstallWorkspaceCombobox'
import type { SkillInstallProviderId } from '../../../../shared/skill-install-providers'
import type {
  SkillLibrarySnapshot,
  SkillLibraryVersion
} from '../../../../shared/skill-library-contract'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import type { SkillInstallDestination } from '../../../../shared/skill-install-contract'
import { translate } from '@/i18n/i18n'

type AssignDialogProps = {
  version: SkillLibraryVersion | null
  versions?: readonly SkillLibraryVersion[]
  progress?: SkillAssignmentBatchProgress | null
  outcomes?: readonly SkillAssignmentBatchResult[] | null
  snapshot: SkillLibrarySnapshot
  busy: boolean
  error: string | null
  onClose(): void
  onAssign(destination: SkillInstallDestination, providers: string[]): void
}

export function SkillLibraryAssignDialog(props: AssignDialogProps) {
  return (
    <SkillLibraryAssignForm
      key={
        props.versions?.map((row) => row.versionId).join(',') ??
        props.version?.versionId ??
        'closed'
      }
      {...props}
    />
  )
}

function SkillLibraryAssignForm(props: AssignDialogProps) {
  const [hostId, setHostId] = useState('local')
  const [scope, setScope] = useState<'global' | 'workspace'>('global')
  const [workspace, setWorkspace] = useState('')
  const [providers, setProviders] = useState<Set<SkillInstallProviderId>>(new Set(['codex']))
  const [reviewed, setReviewed] = useState(false)
  const versions = props.versions ?? (props.version ? [props.version] : [])
  const bulk = props.versions !== undefined
  const locked = props.busy || Boolean(props.outcomes)
  const id = useId()
  const choices = props.snapshot.workspaces.filter((row) => row.hostId === hostId)
  const selected = choices.find((row) => `${row.kind}:${row.id}` === workspace)
  const host = parseExecutionHostId(hostId)
  const validHost =
    (host?.kind === 'local' || host?.kind === 'ssh') &&
    props.snapshot.hosts.some((row) => row.id === hostId)
  const submit = () => {
    if (locked || !validHost || (bulk && !reviewed) || (scope === 'workspace' && !selected)) {
      return
    }
    const destination: SkillInstallDestination =
      scope === 'workspace' && selected
        ? {
            scope: 'workspace',
            ...(selected.kind === 'worktree'
              ? { worktreeId: selected.id }
              : { folderWorkspaceId: selected.id })
          }
        : {
            scope: 'global',
            executionTarget:
              host?.kind === 'ssh' ? { kind: 'ssh', connectionId: host.targetId } : { kind: 'host' }
          }
    props.onAssign(destination, [...providers])
  }
  return (
    <Dialog
      open={props.version !== null}
      onOpenChange={(open) => {
        if (!open && !props.busy) {
          props.onClose()
        }
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden">
        <div className="scrollbar-sleek flex min-h-0 flex-col gap-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {bulk
                ? translate('skills.library.assignBatchTitle', 'Assign {{total}} imported skills', {
                    total: versions.length
                  })
                : translate('skills.library.assignTitle', 'Assign {{name}}', {
                    name: props.version?.name
                  })}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'skills.library.assignHelp',
                'Pin this version to a host and its native coding runtimes. Existing sessions stay running and may load skills only on their next normal start.'
              )}
            </DialogDescription>
          </DialogHeader>
          {bulk ? (
            <section
              aria-label={translate('skills.library.assignmentReview', 'Pinned skills to assign')}
            >
              <ul className="flex flex-col gap-2">
                {versions.map((version) => (
                  <li key={version.versionId} className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-medium">{version.name}</span>
                    <span className="break-all font-mono text-xs text-muted-foreground">
                      {version.versionId}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <fieldset className="flex flex-col gap-3" disabled={locked}>
            <legend className="sr-only">
              {translate('skills.library.destination', 'Installation destination')}
            </legend>
            <Label htmlFor={`${id}-host`}>
              {translate('skills.library.executionHost', 'Execution host')}
            </Label>
            <Select
              value={hostId}
              disabled={locked}
              onValueChange={(value) => {
                setHostId(value)
                setWorkspace('')
                setReviewed(false)
              }}
            >
              <SelectTrigger id={`${id}-host`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {props.snapshot.hosts.map((host) => (
                    <SelectItem key={host.id} value={host.id}>
                      {host.label}
                      {host.reachable
                        ? ''
                        : translate(
                            'skills.library.queuedHost',
                            ' · unavailable (queued until connected)'
                          )}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Label htmlFor={`${id}-scope`}>{translate('skills.library.scope', 'Scope')}</Label>
            <Select
              value={scope}
              disabled={locked}
              onValueChange={(value) => {
                if (value === 'global' || value === 'workspace') {
                  setScope(value)
                  setReviewed(false)
                }
              }}
            >
              <SelectTrigger id={`${id}-scope`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="global">
                    {translate('skills.library.global', 'Global skills')}
                  </SelectItem>
                  <SelectItem value="workspace">
                    {translate('skills.library.workspace', 'Registered workspace')}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            {scope === 'workspace' ? (
              <SkillInstallWorkspaceCombobox
                value={workspace}
                onValueChange={(value) => {
                  setWorkspace(value)
                  setReviewed(false)
                }}
                choices={choices.map((choice) => ({
                  ...choice,
                  id: `${choice.kind}:${choice.id}`
                }))}
                disabled={locked}
              />
            ) : null}
            <SkillInstallAgentPicker
              scope={scope}
              selected={providers}
              detectedAgents={null}
              busy={locked}
              onChange={(value) => {
                setProviders(value)
                setReviewed(false)
              }}
            />
          </fieldset>
          <p className="text-xs text-muted-foreground">
            {translate(
              'skills.library.sharedPlacementHelp',
              'Placements share .agents/skills. Selecting a runtime enables discovery; it is not an access-control restriction for other runtimes that read that shared directory. Local edits and unowned files are never discarded.'
            )}
          </p>
          {bulk ? (
            <Label>
              <Checkbox
                checked={reviewed}
                disabled={locked}
                onCheckedChange={(value) => setReviewed(value === true)}
              />
              {translate(
                'skills.library.assignmentApproval',
                'Assign these pinned skills to the selected destination and runtimes. Existing runtime assignments are retained.'
              )}
            </Label>
          ) : null}
          {props.progress && props.busy ? (
            <p role="status" className="text-xs text-muted-foreground">
              {translate(
                'skills.library.assignmentProgress',
                'Assigning {{index}}/{{total}}: {{name}}',
                props.progress
              )}
            </p>
          ) : null}
          {props.outcomes ? (
            <ul
              aria-label={translate('skills.library.assignmentResults', 'Assignment results')}
              className="flex flex-col gap-2"
            >
              {props.outcomes.map((row) => (
                <li key={row.versionId} className="text-xs">
                  {row.name}: {row.status}
                  {row.message ? ` — ${row.message}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
          {props.error ? (
            <p role="alert" className="text-xs text-destructive">
              {props.error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={props.busy} onClick={props.onClose}>
              {props.outcomes
                ? translate('skills.library.closeResults', 'Close results')
                : translate('skills.library.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={
                locked ||
                !validHost ||
                providers.size === 0 ||
                (scope === 'workspace' && !selected) ||
                (bulk && !reviewed)
              }
              onClick={submit}
            >
              {props.busy
                ? translate('skills.library.provisioning', 'Provisioning…')
                : bulk
                  ? translate('skills.library.assignBatchSubmit', 'Assign {{total}} skills', {
                      total: versions.length
                    })
                  : translate('skills.library.assignPinned', 'Assign pinned version')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
