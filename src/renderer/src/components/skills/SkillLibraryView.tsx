import { ArrowLeft, Download, RefreshCw, Share2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { SKILLS_PAGE_COLUMN } from './skills-page-column'
import { SkillLibraryReviewDialog } from './SkillLibraryReviewDialog'
import { SkillLibraryAssignDialog } from './SkillLibraryAssignDialog'
import { SkillLibraryCatalog } from './SkillLibraryCatalog'
import { SkillLibraryDiscovery } from './SkillLibraryDiscovery'
import { SkillLibraryImportedList } from './SkillLibraryImportedList'
import { SkillLibraryShareDialog } from './SkillLibraryShareDialog'
import { SkillsSelectionHeader } from './SkillsSelectionHeader'
import { SkillSharedLinksView } from './SkillSharedLinksView'
import { useSkillLibraryPage, type SkillLibraryPageProps } from './use-skill-library-page'

export function SkillLibraryView(props: SkillLibraryPageProps) {
  const page = useSkillLibraryPage(props)
  const {
    library,
    shares,
    view,
    setView,
    query,
    setQuery,
    review,
    reviewSource,
    savedReview,
    assignVersion,
    setAssignVersion,
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
      {selecting ? (
        <SkillsSelectionHeader
          title={translate('skills.library.selectImported', 'Select imported skills to share')}
          icon={<Share2 />}
          actionIcon={<Share2 />}
          actionLabel={translate('skills.library.reviewShare', 'Review share')}
          selectedCount={selected.size}
          eligibleCount={snapshot?.versions.length ?? 0}
          busy={library.busy}
          onCancel={() => {
            setSelecting(false)
            setSelected(new Set())
          }}
          onClear={() => setSelected(new Set())}
          onSelectAll={() => {
            const names = new Set<string>()
            setSelected(
              new Set(
                (snapshot?.versions ?? [])
                  .filter((version) => {
                    if (names.has(version.name)) {
                      return false
                    }
                    names.add(version.name)
                    return true
                  })
                  .slice(0, 50)
                  .map((version) => version.versionId)
              )
            )
          }}
          onSubmit={() =>
            setShareVersions(
              snapshot?.versions.filter((version) => selected.has(version.versionId)) ?? []
            )
          }
        />
      ) : (
        <header className="shrink-0 border-b border-border">
          <div className={cn(SKILLS_PAGE_COLUMN, 'flex flex-wrap items-center gap-2 py-3')}>
            {view === 'import' ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={library.busy}
                onClick={() => {
                  setView('catalog')
                  setNotice(null)
                }}
              >
                <ArrowLeft data-icon="inline-start" />
                {translate('skills.library.backImported', 'Back to imported skills')}
              </Button>
            ) : null}
            <h1 className="min-w-0 flex-1 text-sm font-semibold">
              {translate('skills.library.skillsTitle', 'Skills')}
            </h1>
            <Button
              variant="outline"
              size="sm"
              disabled={library.busy}
              onClick={() => {
                setView('import')
                setNotice(null)
              }}
            >
              <Download data-icon="inline-start" />
              {translate('skills.library.importSkills', 'Import skills')}
            </Button>
            <Button
              size="sm"
              disabled={library.busy || !snapshot?.versions.length}
              onClick={() => {
                setView('catalog')
                setSelecting(true)
                setSelected(new Set())
              }}
            >
              <Share2 data-icon="inline-start" />
              {translate('skills.library.shareSkills', 'Share skills')}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={library.busy}
              onClick={() => {
                void library.refresh()
                shares.refresh()
              }}
              aria-label={translate('skills.library.refresh', 'Refresh')}
            >
              <RefreshCw />
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
      )}
      {view !== 'import' ? (
        <div className={cn(SKILLS_PAGE_COLUMN, 'flex w-full flex-wrap items-center gap-3 py-3')}>
          <Tabs
            value={view}
            onValueChange={(next) => {
              if (next === 'catalog' || next === 'assignments' || next === 'shared') {
                setView(next)
                setNotice(null)
                setSelecting(false)
                setSelected(new Set())
              }
            }}
          >
            <TabsList>
              <TabsTrigger value="catalog">
                {translate('skills.library.importedTab', 'Imported skills')} (
                {snapshot?.versions.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="assignments">
                {translate('skills.library.assignmentsTab', 'Assignments')}
              </TabsTrigger>
              <TabsTrigger value="shared">
                {translate('skills.library.sharedTab', 'Shared links')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={translate(
              'skills.library.searchImported',
              'Search imported skills or links'
            )}
            placeholder={translate(
              'skills.library.searchImported',
              'Search imported skills or links'
            )}
            className="min-w-0 flex-1"
          />
        </div>
      ) : null}
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
                ? translate('skills.library.loading', 'Loading library…')
                : translate(
                    'skills.library.connectHelp',
                    'Connect to an updated Orca server and refresh.'
                  )}
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
          shares.refresh()
        }}
        onPublish={page.publish}
      />
    </main>
  )
}
