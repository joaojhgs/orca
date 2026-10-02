import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type {
  SkillLibraryAssignment,
  SkillLibrarySnapshot,
  SkillLibraryVersion
} from '../../../../shared/skill-library-contract'

export function SkillLibraryCatalog(props: {
  snapshot: SkillLibrarySnapshot
  busy: boolean
  query: string
  onAssign(version: SkillLibraryVersion): void
  onDelete(version: SkillLibraryVersion): void
  onRetry(assignment: SkillLibraryAssignment): void
  onUnassign(assignment: SkillLibraryAssignment): void
}) {
  const matches = (name: string) => name.toLowerCase().includes(props.query.toLowerCase())
  const versions = props.snapshot.versions.filter((version) => matches(version.name))
  const assignments = props.snapshot.assignments.filter(
    (assignment) =>
      assignment.status !== 'removed' &&
      matches(
        props.snapshot.versions.find((version) => version.versionId === assignment.versionId)
          ?.name ?? assignment.id
      )
  )
  return (
    <>
      <section
        className="flex flex-col gap-3"
        aria-label={translate('skills.library.savedLabel', 'Saved skill versions')}
      >
        <h2 className="text-sm font-semibold">
          {translate('skills.library.savedVersions', 'Saved versions ({{total}})', {
            total: versions.length
          })}
        </h2>
        {versions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {translate(
              'skills.library.emptyVersions',
              'Review and import a discovered skill to save an immutable local copy.'
            )}
          </p>
        ) : null}
        <ul className="flex flex-col gap-3">
          {versions.map((version) => (
            <li
              key={version.versionId}
              className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3"
            >
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium">{version.name}</h3>
                <p className="text-xs text-muted-foreground">{version.description}</p>
                <p className="break-all font-mono text-xs text-muted-foreground">
                  {version.versionId} ·{' '}
                  {translate('skills.library.files', '{{total}} files', {
                    total: version.files.length
                  })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {version.origins
                    .map(
                      (origin) =>
                        `${props.snapshot.hosts.find((host) => host.id === origin.hostId)?.label ?? origin.hostId}: ${origin.sourceLabel}`
                    )
                    .join(' · ')}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={props.busy} onClick={() => props.onAssign(version)}>
                  {translate('skills.library.assign', 'Assign')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    props.busy ||
                    props.snapshot.assignments.some(
                      (row) => row.versionId === version.versionId && row.status !== 'removed'
                    )
                  }
                  onClick={() => props.onDelete(version)}
                >
                  {translate('skills.library.deleteVersion', 'Delete version')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section
        className="flex flex-col gap-3"
        aria-label={translate('skills.library.assignmentsLabel', 'Skill assignments')}
      >
        <h2 className="text-sm font-semibold">
          {translate('skills.library.assignments', 'Assignments ({{total}})', {
            total: assignments.length
          })}
        </h2>
        {assignments.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {translate(
              'skills.library.emptyAssignments',
              'Assign a saved version to an execution host. No agent restart is required to provision files.'
            )}
          </p>
        ) : null}
        <ul className="flex flex-col gap-3">
          {assignments.map((assignment) => {
            const version = props.snapshot.versions.find(
              (row) => row.versionId === assignment.versionId
            )
            const destination = assignment.destination
            const workspace =
              destination.scope === 'workspace'
                ? props.snapshot.workspaces.find(
                    (row) =>
                      row.id === (destination.worktreeId ?? destination.folderWorkspaceId) &&
                      row.kind === (destination.worktreeId ? 'worktree' : 'folder')
                  )
                : null
            return (
              <li
                key={assignment.id}
                className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium">{version?.name ?? assignment.packageId}</h3>
                    <Badge
                      variant={
                        assignment.status === 'conflict' || assignment.status === 'failed'
                          ? 'destructive'
                          : 'secondary'
                      }
                    >
                      {assignment.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {props.snapshot.hosts.find((host) => host.id === assignment.executionHostId)
                      ?.label ?? assignment.executionHostId}{' '}
                    ·{' '}
                    {destination.scope === 'global'
                      ? translate('skills.library.global', 'Global skills')
                      : (workspace?.label ??
                        translate(
                          'skills.library.workspaceUnavailable',
                          'Workspace unavailable'
                        ))}{' '}
                    · {assignment.providers.join(', ')}
                  </p>
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    {translate('skills.library.pinnedVersion', 'Pinned version: {{version}}', {
                      version: assignment.versionId
                    })}
                  </p>
                  {assignment.desiredState === 'removed' ? (
                    <p className="text-xs text-muted-foreground">
                      {translate('skills.library.removalRequested', 'Removal requested')}
                    </p>
                  ) : null}
                  {assignment.message ? (
                    <p className="text-xs text-muted-foreground">{assignment.message}</p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={props.busy}
                    onClick={() => props.onRetry(assignment)}
                  >
                    {translate('skills.library.reconcile', 'Reconcile')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={props.busy}
                    onClick={() => props.onUnassign(assignment)}
                  >
                    {translate('skills.library.unassign', 'Unassign')}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}
