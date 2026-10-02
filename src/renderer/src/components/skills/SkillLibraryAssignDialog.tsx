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
  snapshot: SkillLibrarySnapshot
  busy: boolean
  error: string | null
  onClose(): void
  onAssign(destination: SkillInstallDestination, providers: string[]): void
}

export function SkillLibraryAssignDialog(props: AssignDialogProps) {
  return <SkillLibraryAssignForm key={props.version?.versionId ?? 'closed'} {...props} />
}

function SkillLibraryAssignForm(props: AssignDialogProps) {
  const [hostId, setHostId] = useState('local')
  const [scope, setScope] = useState<'global' | 'workspace'>('global')
  const [workspace, setWorkspace] = useState('')
  const [providers, setProviders] = useState<Set<SkillInstallProviderId>>(new Set(['codex']))
  const id = useId()
  const choices = props.snapshot.workspaces.filter((row) => row.hostId === hostId)
  const selected = choices.find((row) => `${row.kind}:${row.id}` === workspace)
  const submit = () => {
    const host = parseExecutionHostId(hostId)
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
              {translate('skills.library.assignTitle', 'Assign {{name}}', {
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
          <fieldset className="flex flex-col gap-3" disabled={props.busy}>
            <legend className="sr-only">
              {translate('skills.library.destination', 'Installation destination')}
            </legend>
            <Label htmlFor={`${id}-host`}>
              {translate('skills.library.executionHost', 'Execution host')}
            </Label>
            <Select
              value={hostId}
              disabled={props.busy}
              onValueChange={(value) => {
                setHostId(value)
                setWorkspace('')
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
              disabled={props.busy}
              onValueChange={(value) => {
                if (value === 'global' || value === 'workspace') {
                  setScope(value)
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
                onValueChange={setWorkspace}
                choices={choices.map((choice) => ({
                  ...choice,
                  id: `${choice.kind}:${choice.id}`
                }))}
                disabled={props.busy}
              />
            ) : null}
            <SkillInstallAgentPicker
              scope={scope}
              selected={providers}
              detectedAgents={null}
              busy={props.busy}
              onChange={setProviders}
            />
          </fieldset>
          <p className="text-xs text-muted-foreground">
            {translate(
              'skills.library.sharedPlacementHelp',
              'Placements share .agents/skills. Selecting a runtime enables discovery; it is not an access-control restriction for other runtimes that read that shared directory. Local edits and unowned files are never discarded.'
            )}
          </p>
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
              disabled={props.busy || providers.size === 0 || (scope === 'workspace' && !selected)}
              onClick={submit}
            >
              {props.busy
                ? translate('skills.library.provisioning', 'Provisioning…')
                : translate('skills.library.assignPinned', 'Assign pinned version')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
