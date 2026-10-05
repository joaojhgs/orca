import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { SkillLibrarySnapshot } from '../../../../shared/skill-library-contract'
import type { HostedSkillCandidate } from './skill-library-host-discovery'
import { SkillLibraryBulkImport } from './SkillLibraryBulkImport'
import type { useSkillLibrary } from './use-skill-library'
import { SkillLibraryLinkImport } from './SkillLibraryLinkImport'

export function SkillLibraryDiscovery(props: {
  hosts: SkillLibrarySnapshot['hosts']
  hostId: string
  candidates: HostedSkillCandidate[] | null
  query: string
  busy: boolean
  library: ReturnType<typeof useSkillLibrary>
  onLinkCandidates(candidates: HostedSkillCandidate[]): void
  onHost(value: string): void
  onQuery(value: string): void
  onScan(): void
  onPreview(candidate: HostedSkillCandidate): void
}) {
  const visible = useMemo(
    () =>
      props.candidates?.filter((candidate) =>
        `${candidate.name} ${candidate.description ?? ''} ${candidate.sourceLabel} ${candidate.hostLabel}`
          .toLowerCase()
          .includes(props.query.toLowerCase())
      ),
    [props.candidates, props.query]
  )
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={translate('skills.library.discoverLabel', 'Discover skills to import')}
    >
      <h2 className="text-sm font-semibold">
        {translate('skills.library.discover', 'Discover and import')}
      </h2>
      <SkillLibraryLinkImport library={props.library} onCandidates={props.onLinkCandidates} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Label htmlFor="skill-library-source-host">
            {translate('skills.library.sourceHost', 'Source host')}
          </Label>
          <Select value={props.hostId} disabled={props.busy} onValueChange={props.onHost}>
            <SelectTrigger id="skill-library-source-host" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">
                  {translate('skills.library.allHosts', 'All connected hosts')}
                </SelectItem>
                {props.hosts.map((host) => (
                  <SelectItem key={host.id} value={host.id} disabled={!host.reachable}>
                    {host.label}
                    {host.reachable
                      ? ''
                      : translate('skills.library.unavailableHost', ' · unavailable')}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <Button
          disabled={
            props.busy ||
            !props.hosts.some(
              (host) => (props.hostId === 'all' || host.id === props.hostId) && host.reachable
            )
          }
          onClick={props.onScan}
        >
          {props.busy
            ? translate('skills.library.working', 'Working…')
            : props.hostId === 'all'
              ? translate('skills.library.scanHosts', 'Scan hosts')
              : translate('skills.library.scan', 'Scan host')}
        </Button>
      </div>
      <Input
        aria-label={translate('skills.library.searchLabel', 'Search library and discovered skills')}
        placeholder={translate('skills.library.search', 'Search skills…')}
        value={props.query}
        onChange={(event) => props.onQuery(event.target.value)}
      />
      {props.candidates === null ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'skills.library.scanHostsHelp',
            'Scan installed skills on the selected hosts. Review imports before assigning them to runtimes; nothing is imported automatically.'
          )}
        </p>
      ) : visible?.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'skills.library.noMatches',
            'No matching skills found. Check the selected host or search.'
          )}
        </p>
      ) : (
        <SkillLibraryBulkImport
          key={JSON.stringify(visible?.map((row) => [row.hostId, row.id]))}
          candidates={visible ?? []}
          library={props.library}
          onPreview={props.onPreview}
        />
      )}
    </section>
  )
}
