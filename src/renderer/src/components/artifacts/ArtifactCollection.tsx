import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { ArtifactListItem } from '../../../../shared/artifacts'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { clampArtifactListSearchQuery, filterArtifactsBySearchQuery } from './artifact-list-search'
import { ArtifactListRows } from './ArtifactListRows'
import { ArtifactListTableHeader } from './ArtifactListTableHeader'
import { ArtifactListToolbar } from './ArtifactListToolbar'
import { LIST_TABLE_CONTAINER_CLASS } from '@/lib/list-table-layout'
import {
  artifactProject,
  groupArtifactsByProject,
  UNASSIGNED_ARTIFACT_PROJECT,
  type ArtifactProjectRoot
} from './artifact-project-groups'

const NO_PROJECT_ROOTS: readonly ArtifactProjectRoot[] = []

export function ArtifactCollection({
  artifacts,
  deletingId,
  selectedSlug,
  selectArtifact,
  deleteArtifact,
  hasMore,
  loadingMore,
  loadMore,
  onRefresh,
  isRefreshing,
  projectRoots = NO_PROJECT_ROOTS
}: {
  artifacts: readonly ArtifactListItem[]
  deletingId: string | null
  selectedSlug: string | null
  selectArtifact: (slug: string) => void
  deleteArtifact: (item: ArtifactListItem) => void
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => void
  onRefresh: () => void
  isRefreshing: boolean
  projectRoots?: readonly ArtifactProjectRoot[]
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [projectFilter, setProjectFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  // Why: clamp on the way in so a multi-MB paste never reaches state or filtering.
  const onQueryChange = (next: string): void => setQuery(clampArtifactListSearchQuery(next))
  const unassignedName = translate('artifacts.projects.unassigned', 'Unassigned project')
  const projects = useMemo(
    () => groupArtifactsByProject(artifacts, projectRoots, unassignedName),
    [artifacts, projectRoots, unassignedName]
  )
  const matches = useMemo(
    () =>
      filterArtifactsBySearchQuery(artifacts, query).filter(
        (item) =>
          (projectFilter === 'all' ||
            (artifactProject(item, projectRoots)?.projectId ?? UNASSIGNED_ARTIFACT_PROJECT) ===
              projectFilter) &&
          (typeFilter === 'all' || item.artifact.sourceContentType === typeFilter)
      ),
    [artifacts, query, projectRoots, projectFilter, typeFilter]
  )
  const groups = useMemo(
    () => groupArtifactsByProject(matches, projectRoots, unassignedName),
    [matches, projectRoots, unassignedName]
  )
  // Why: state, not a ref — the windowed rows need the scroller on their own mount pass.
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-4 md:px-5">
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <ArtifactListToolbar
          query={query}
          onQueryChange={onQueryChange}
          onRefresh={onRefresh}
          isRefreshing={isRefreshing}
          projects={projects}
          projectFilter={projectFilter}
          onProjectFilterChange={setProjectFilter}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
        />
        <div
          ref={setScrollElement}
          className={cn('scrollbar-sleek min-h-0 flex-1 overflow-auto', LIST_TABLE_CONTAINER_CLASS)}
        >
          <ArtifactListTableHeader />
          {/* Why no width wrapper around the rows: a `w-fit` band sizes to the full scroll width,
              painting every row's hover and selection wash past the viewport edge (376px -> 468px). */}
          {matches.length > 0 ? (
            <ArtifactListRows
              artifacts={matches}
              groups={artifacts.some((item) => item.sourceKey) ? groups : undefined}
              deletingId={deletingId}
              selectedSlug={selectedSlug}
              scrollElement={scrollElement}
              hasMore={hasMore}
              selectArtifact={selectArtifact}
              deleteArtifact={deleteArtifact}
            />
          ) : (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {translate('auto.components.artifacts.ArtifactCollection.noMatches', 'No matches')}
            </p>
          )}
          {hasMore ? (
            <div className="border-t border-border/50 p-2">
              <p className="px-3 py-1 text-xs text-muted-foreground">
                {translate(
                  'artifacts.filters.loadedOnly',
                  'Groups and filters include loaded artifacts. Load more to include older pages.'
                )}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore ? <Loader2 className="animate-spin" /> : null}
                {translate('auto.components.artifacts.ArtifactCollection.loadMore', 'Load more')}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
