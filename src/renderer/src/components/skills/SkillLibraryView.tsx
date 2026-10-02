import { useRef, useState } from 'react'
import { ArrowLeft, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import {
  SkillLibraryImportResultSchema,
  SkillLibraryPreviewSchema,
  type SkillLibraryPreview,
  type SkillLibraryVersion
} from '../../../../shared/skill-library-contract'
import { SKILLS_PAGE_COLUMN } from './skills-page-column'
import { useSkillLibrary } from './use-skill-library'
import { SkillLibraryReviewDialog } from './SkillLibraryReviewDialog'
import { SkillLibraryAssignDialog } from './SkillLibraryAssignDialog'
import { SkillLibraryCatalog } from './SkillLibraryCatalog'
import { SkillLibraryDiscovery } from './SkillLibraryDiscovery'
import {
  discoverSkillLibraryHosts,
  type HostedSkillCandidate
} from './skill-library-host-discovery'

type Confirmation = { kind: 'delete' | 'unassign'; id: string; name: string }

export function SkillLibraryView(props: {
  target: RuntimeClientTarget | null
  onBack(): void
  onClose(): void
}) {
  const library = useSkillLibrary(props.target)
  const [hostId, setHostId] = useState('all')
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<HostedSkillCandidate[] | null>(null)
  const [review, setReview] = useState<SkillLibraryPreview | null>(null)
  const [reviewHostId, setReviewHostId] = useState<string | null>(null)
  const [assignVersion, setAssignVersion] = useState<SkillLibraryVersion | null>(null)
  const confirmDialog = useConfirmationDialog()
  const owner = useRef(props.target)
  owner.current = props.target
  const [notice, setNotice] = useState<string | null>(null)
  const [stateTarget, setStateTarget] = useState(props.target)
  if (stateTarget !== props.target) {
    setStateTarget(props.target)
    setCandidates(null)
    setReview(null)
    setAssignVersion(null)
    setNotice(null)
    setReviewHostId(null)
    setHostId('all')
    setQuery('')
  }
  const scan = async () => {
    const result = await library.run((target) =>
      discoverSkillLibraryHosts(target, library.snapshot?.hosts ?? [], hostId)
    )
    if (result) {
      setCandidates(result.candidates)
      setNotice(result.issues.length ? result.issues.join(' · ') : null)
    }
  }
  const preview = async (sourceHostId: string, candidateId: string, filePath?: string) => {
    const result = await library.run(async (target) =>
      SkillLibraryPreviewSchema.parse(
        await callRuntimeRpc(
          target,
          'skills.library.preview',
          { hostId: sourceHostId, candidateId, filePath },
          { timeoutMs: 120000 }
        )
      )
    )
    if (result) {
      setReview(result)
      setReviewHostId(sourceHostId)
    }
  }
  const importReview = async (addVersion: boolean) => {
    if (!review || !reviewHostId) {
      return
    }
    const response = await library.mutate('skills.library.import', {
      hostId: reviewHostId,
      candidateIds: [review.candidate.id],
      reviewed: true,
      addVersion,
      expectedDigests: [{ candidateId: review.candidate.id, packageDigest: review.packageDigest }]
    })
    if (!response) {
      return
    }
    const result = SkillLibraryImportResultSchema.safeParse(response)
    if (!result.success) {
      setNotice(
        translate(
          'skills.library.unexpectedImport',
          'Unexpected import response. Refresh the library before retrying.'
        )
      )
      return
    }
    setNotice(
      result.data.results
        .map((row) => `${row.status}${row.message ? `: ${row.message}` : ''}`)
        .join(' · ')
    )
    if (
      result.data.results.every((row) => row.status === 'imported' || row.status === 'unchanged')
    ) {
      setReview(null)
    }
  }
  const confirm = async (confirmation: Confirmation) => {
    const target = props.target
    const approved = await confirmDialog({
      title:
        confirmation.kind === 'delete'
          ? translate('skills.library.deleteTitle', 'Delete saved version: {{name}}', {
              name: confirmation.name
            })
          : translate('skills.library.unassignTitle', 'Unassign skill: {{name}}', {
              name: confirmation.name
            }),
      description:
        confirmation.kind === 'delete'
          ? translate(
              'skills.library.deleteHelp',
              'Remove this unassigned snapshot from the library. Original skill folders are not deleted.'
            )
          : translate(
              'skills.library.unassignHelp',
              'Remove only Orca-owned, unmodified placements. Edited files and unowned originals remain protected; an offline host queues removal.'
            ),
      confirmLabel:
        confirmation.kind === 'delete'
          ? translate('skills.library.deleteVersion', 'Delete version')
          : translate('skills.library.unassign', 'Unassign'),
      confirmVariant: 'destructive'
    })
    if (!approved || owner.current !== target) {
      return
    }
    const response = await library.mutate(
      confirmation.kind === 'delete' ? 'skills.library.deleteVersion' : 'skills.library.unassign',
      confirmation.kind === 'delete'
        ? { versionId: confirmation.id }
        : { assignmentId: confirmation.id }
    )
    if (response !== undefined) {
      setNotice(null)
    }
  }
  const snapshot = library.snapshot
  const importProblem = notice && review ? notice : null
  return (
    <main className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="shrink-0 border-b border-border">
        <div className={cn(SKILLS_PAGE_COLUMN, 'flex flex-wrap items-center gap-2 py-3')}>
          <Button variant="ghost" size="sm" onClick={props.onBack}>
            <ArrowLeft data-icon="inline-start" />
            {translate('skills.library.installedBack', 'Installed skills and sharing')}
          </Button>
          <h1 className="min-w-0 flex-1 text-sm font-semibold">
            {translate('skills.library.title', 'Local skill library')}
          </h1>
          <Button
            variant="outline"
            size="sm"
            disabled={library.busy}
            onClick={() => void library.refresh()}
          >
            <RefreshCw data-icon="inline-start" />
            {translate('skills.library.refresh', 'Refresh')}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={props.onClose}
            aria-label={translate('skills.library.close', 'Close skills')}
          >
            <X />
          </Button>
        </div>
      </header>
      <section className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        <div className={cn(SKILLS_PAGE_COLUMN, 'flex flex-col gap-6 py-4')}>
          <p className="text-xs text-muted-foreground">
            {translate(
              'skills.library.storageHelp',
              'Stored on this Orca server, without Cloud. Importing preserves the original; assignments pin copies to native runtime skill directories.'
            )}
          </p>
          {library.error ? (
            <p role="alert" className="text-sm text-destructive">
              {library.error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-xs text-muted-foreground">
              {notice}
            </p>
          ) : null}
          {!snapshot ? (
            <p className="text-sm text-muted-foreground">
              {library.busy
                ? translate('skills.library.loading', 'Loading library…')
                : translate(
                    'skills.library.connectHelp',
                    'Connect to an updated Orca server and refresh.'
                  )}
            </p>
          ) : (
            <>
              <SkillLibraryDiscovery
                hosts={snapshot.hosts}
                hostId={hostId}
                candidates={candidates}
                query={query}
                busy={library.busy}
                onHost={(value) => {
                  setHostId(value)
                  setCandidates(null)
                  setReview(null)
                  setNotice(null)
                }}
                onQuery={setQuery}
                onScan={() => void scan()}
                onPreview={(candidate) => void preview(candidate.hostId, candidate.id)}
              />
              <SkillLibraryCatalog
                snapshot={snapshot}
                busy={library.busy}
                query={query}
                onAssign={setAssignVersion}
                onDelete={(version) =>
                  void confirm({ kind: 'delete', id: version.versionId, name: version.name })
                }
                onRetry={(assignment) =>
                  void library.mutate('skills.library.reconcile', { assignmentId: assignment.id })
                }
                onUnassign={(assignment) =>
                  void confirm({
                    kind: 'unassign',
                    id: assignment.id,
                    name:
                      snapshot.versions.find(
                        (version) => version.versionId === assignment.versionId
                      )?.name ?? assignment.id
                  })
                }
              />
              <SkillLibraryAssignDialog
                version={assignVersion}
                snapshot={snapshot}
                busy={library.busy}
                error={library.error}
                onClose={() => setAssignVersion(null)}
                onAssign={(destination, providers) => {
                  if (assignVersion) {
                    void library
                      .mutate('skills.library.assign', {
                        versionId: assignVersion.versionId,
                        destination,
                        providers
                      })
                      .then((result) => {
                        if (result) {
                          setAssignVersion(null)
                        }
                      })
                  }
                }}
              />
            </>
          )}
        </div>
      </section>
      <SkillLibraryReviewDialog
        review={review}
        busy={library.busy}
        error={library.error ?? importProblem}
        onClose={() => {
          setReview(null)
          setNotice(null)
        }}
        onFile={(filePath) => {
          if (review && reviewHostId) {
            void preview(reviewHostId, review.candidate.id, filePath)
          }
        }}
        onImport={(addVersion) => void importReview(addVersion)}
      />
    </main>
  )
}
