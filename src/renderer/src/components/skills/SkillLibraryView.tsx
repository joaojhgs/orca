import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { SKILLS_PAGE_COLUMN } from './catalog/skills-page-column'
import { SkillLibraryReviewDialog } from './SkillLibraryReviewDialog'
import { SkillLibraryAssignDialog } from './SkillLibraryAssignDialog'
import { SkillLibraryCatalog } from './SkillLibraryCatalog'
import { SkillLibraryDiscovery } from './SkillLibraryDiscovery'
import { SkillLibraryImportedList } from './SkillLibraryImportedList'
import { SkillLibraryShareDialog } from './SkillLibraryShareDialog'
import { SkillLibraryPageHeader } from './SkillLibraryPageHeader'
import { SkillLibraryBulkAssign } from './SkillLibraryBulkAssign'
import { SkillSharedLinksView } from './sharing/SkillSharedLinksView'
import { useSkillLibraryPage, type SkillLibraryPageProps } from './use-skill-library-page'
import { toggleLibrarySelection } from '../../../../shared/skill-library-plugin'
import { assignSkillDestinations } from './skill-library-batch-destinations'

export function SkillLibraryView(props: SkillLibraryPageProps) {
  const t = useTranslate()
  const page = useSkillLibraryPage(props)
  const {
    library,
    shares,
    view,
    setView,
    query,
    review,
    reviewSource,
    savedReview,
    assignVersion,
    setAssignVersion,
    bulkAssignVersions,
    setBulkAssignVersions,
    selecting,
    setSelecting,
    selected,
    setSelected,
    shareVersions,
    setShareVersions,
    notice,
    setNotice
  } = page
  const snapshot = library.snapshot
  return (
    <main className="flex min-h-0 flex-1 flex-col bg-background">
      <SkillLibraryPageHeader page={page} onClose={props.onClose} />
      <section className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        <div className={cn(SKILLS_PAGE_COLUMN, 'flex flex-col gap-4 py-3')}>
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
            <p className="text-xs text-muted-foreground">
              {library.busy
                ? t('skills.library.loading', 'Loading library…')
                : t('skills.library.connectHelp', 'Connect to an updated Orca server and refresh.')}
            </p>
          ) : (
            <>
              {view === 'import' ? (
                <SkillLibraryDiscovery
                  hosts={snapshot.hosts}
                  hostId={page.hostId}
                  candidates={page.candidates}
                  query={page.importQuery}
                  busy={library.busy}
                  library={library}
                  onLinkCandidates={page.setCandidates}
                  onHost={(value) => {
                    page.setHostId(value)
                    page.setCandidates(null)
                    setNotice(null)
                  }}
                  onQuery={page.setImportQuery}
                  onScan={() => void page.scan()}
                  onPreview={(candidate) =>
                    void page.preview({ hostId: candidate.hostId, candidateId: candidate.id })
                  }
                />
              ) : null}
              {view === 'catalog' ? (
                <SkillLibraryImportedList
                  snapshot={snapshot}
                  query={query}
                  busy={library.busy}
                  selecting={selecting}
                  selected={selected}
                  onSelected={page.select}
                  onSelectedMany={(versions, checked) => {
                    const ids = versions.map((row) => row.versionId)
                    const names = new Set(versions.map((row) => row.name))
                    const retained = new Set(
                      [...selected].filter(
                        (id) =>
                          !checked ||
                          !snapshot.versions.some(
                            (row) => row.versionId === id && names.has(row.name)
                          )
                      )
                    )
                    if (checked && new Set([...retained, ...ids]).size > 50) {
                      setNotice(
                        t(
                          'skills.library.pluginSelectionLimit',
                          'This selection exceeds 50 skills. Select a smaller plugin subset.'
                        )
                      )
                      return
                    }
                    setSelecting(true)
                    setSelected(toggleLibrarySelection(retained, ids, checked))
                  }}
                  onAssignMany={setBulkAssignVersions}
                  onShareMany={setShareVersions}
                  onReview={(version) => void page.preview(version)}
                  onAssign={setAssignVersion}
                  onShare={(version) => setShareVersions([version])}
                  onDelete={(version) =>
                    void page.confirm({ kind: 'delete', id: version.versionId, name: version.name })
                  }
                />
              ) : null}
              {view === 'shared' ? <SkillSharedLinksView query={query} shares={shares} /> : null}
              {view === 'assignments' ? (
                <SkillLibraryCatalog
                  assignmentsOnly
                  snapshot={snapshot}
                  busy={library.busy}
                  query={query}
                  onAssign={setAssignVersion}
                  onDelete={(version) =>
                    void page.confirm({ kind: 'delete', id: version.versionId, name: version.name })
                  }
                  onRetry={(assignment) =>
                    void library.mutate('skills.library.reconcile', { assignmentId: assignment.id })
                  }
                  onUnassign={(assignment) =>
                    void page.confirm({
                      kind: 'unassign',
                      id: assignment.id,
                      name:
                        snapshot.versions.find(
                          (version) => version.versionId === assignment.versionId
                        )?.name ?? assignment.id
                    })
                  }
                />
              ) : null}
              <SkillLibraryAssignDialog
                version={assignVersion}
                snapshot={snapshot}
                busy={library.busy}
                error={library.error}
                onClose={() => setAssignVersion(null)}
                onAssign={(destination, providers) => {
                  if (assignVersion) {
                    if (Array.isArray(destination)) {
                      void library
                        .run((target) =>
                          assignSkillDestinations({
                            target,
                            versions: [assignVersion],
                            snapshot,
                            destinations: destination,
                            providers,
                            isCurrent: () => true,
                            onProgress: () => {}
                          })
                        )
                        .then(async (results) => {
                          if (results) {
                            setNotice(
                              results
                                .map(
                                  (row) => `${row.name}: ${row.status} · ${row.destinationLabel}`
                                )
                                .join(' · ')
                            )
                            setAssignVersion(null)
                            await library.refresh()
                          }
                        })
                      return
                    }
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
              {bulkAssignVersions.length ? (
                <SkillLibraryBulkAssign
                  key={bulkAssignVersions.map((version) => version.versionId).join(',')}
                  versions={bulkAssignVersions}
                  snapshot={snapshot}
                  library={library}
                  onClose={() => setBulkAssignVersions([])}
                  onCompleted={(results) => {
                    const unresolved = results.filter(
                      (row) => !['installed', 'pending', 'unavailable'].includes(row.status)
                    )
                    setSelected(new Set(unresolved.map((row) => row.versionId)))
                    if (!unresolved.length) {
                      setSelecting(false)
                    }
                    setNotice(
                      results
                        .map(
                          (row) =>
                            `${row.name}: ${row.status}${row.message ? ` — ${row.message}` : ''}`
                        )
                        .join(' · ')
                    )
                  }}
                />
              ) : null}
            </>
          )}
        </div>
      </section>
      <SkillLibraryReviewDialog
        review={review}
        saved={Boolean(savedReview)}
        busy={library.busy}
        error={library.error ?? notice}
        onClose={() => {
          page.setReview(null)
          page.setReviewSource(null)
          page.setSavedReview(null)
          setNotice(null)
        }}
        onFile={(filePath) => {
          if (savedReview) {
            void page.preview(savedReview, filePath)
          } else if (reviewSource) {
            void page.preview(reviewSource, filePath)
          }
        }}
        onImport={(addVersion) => void page.importReview(addVersion)}
        onAssign={() => {
          setAssignVersion(savedReview)
          page.setReview(null)
          page.setSavedReview(null)
        }}
      />
      <SkillLibraryShareDialog
        versions={shareVersions}
        busy={library.busy}
        error={library.error}
        onClose={() => {
          setShareVersions([])
          setSelecting(false)
          setSelected(new Set())
        }}
        onManageLinks={() => {
          setShareVersions([])
          setSelecting(false)
          setView('shared')
          page.shares.refresh()
        }}
        onPublish={page.publish}
      />
    </main>
  )
}
