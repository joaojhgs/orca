import { ArrowLeft, Download, FolderInput, RefreshCw, Share2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { SKILLS_PAGE_COLUMN } from './skills-page-column'
import { SkillsSelectionHeader } from './SkillsSelectionHeader'
import type { useSkillLibraryPage } from './use-skill-library-page'

export function SkillLibraryPageHeader({
  page,
  onClose
}: {
  page: ReturnType<typeof useSkillLibraryPage>
  onClose(): void
}) {
  const {
    library,
    shares,
    view,
    setView,
    query,
    setQuery,
    selecting,
    setSelecting,
    selected,
    setSelected,
    selectionAction,
    setSelectionAction,
    setBulkAssignVersions,
    setShareVersions,
    setNotice
  } = page
  const snapshot = library.snapshot
  const names = new Set<string>()
  const eligible = (snapshot?.versions ?? [])
    .filter((version) => {
      if (
        !`${version.name} ${version.description}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()) ||
        names.has(version.name)
      ) {
        return false
      }
      names.add(version.name)
      return true
    })
    .slice(0, 50)
  return (
    <>
      {selecting ? (
        <SkillsSelectionHeader
          title={
            selectionAction === 'assign'
              ? translate('skills.library.selectAssign', 'Select imported skills to assign')
              : translate('skills.library.selectImported', 'Select imported skills to share')
          }
          icon={selectionAction === 'assign' ? <FolderInput /> : <Share2 />}
          actionIcon={selectionAction === 'assign' ? <FolderInput /> : <Share2 />}
          actionLabel={
            selectionAction === 'assign'
              ? translate('skills.library.reviewAssignment', 'Review assignment')
              : translate('skills.library.reviewShare', 'Review share')
          }
          selectedCount={selected.size}
          eligibleCount={eligible.length}
          busy={library.busy}
          onCancel={() => {
            setSelecting(false)
            setSelected(new Set())
          }}
          onClear={() => setSelected(new Set())}
          onSelectAll={() => setSelected(new Set(eligible.map((version) => version.versionId)))}
          onSubmit={() => {
            const versions =
              snapshot?.versions.filter((version) => selected.has(version.versionId)) ?? []
            if (selectionAction === 'assign') {
              setBulkAssignVersions(versions)
            } else {
              setShareVersions(versions)
            }
          }}
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
              variant="outline"
              size="sm"
              disabled={library.busy || !snapshot?.versions.length}
              onClick={() => {
                setView('catalog')
                setSelectionAction('assign')
                setSelecting(true)
                setSelected(new Set())
                setNotice(null)
              }}
            >
              <FolderInput data-icon="inline-start" />
              {translate('skills.library.assignSkills', 'Assign skills')}
            </Button>
            <Button
              size="sm"
              disabled={library.busy || !snapshot?.versions.length}
              onClick={() => {
                setView('catalog')
                setSelectionAction('share')
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
              onClick={onClose}
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
    </>
  )
}
