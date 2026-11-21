import { Fragment } from 'react'
import { VirtualizedList } from '@/components/ui/virtualized-list'
import type { ArtifactListItem } from '../../../../shared/artifacts/artifacts'
import { ArtifactListRow } from './ArtifactListRow'
import { ARTIFACTS_TABLE_ROW_HEIGHT_PX } from './artifacts-table-layout'
import type { ArtifactProjectGroup } from './artifact-project-groups'

/** Window the append-only artifact list inside the collection scroller; below the threshold, keep natural flow. */
export function ArtifactListRows({
  artifacts,
  groups,
  deletingId,
  selectedSlug,
  scrollElement,
  hasMore,
  selectArtifact,
  deleteArtifact
}: {
  artifacts: readonly ArtifactListItem[]
  groups?: readonly ArtifactProjectGroup[]
  deletingId: string | null
  selectedSlug: string | null
  scrollElement: HTMLDivElement | null
  // Propagate the cursor so rows do not announce loaded count as the total while Load more still exists.
  hasMore: boolean
  selectArtifact: (slug: string) => void
  deleteArtifact: (item: ArtifactListItem) => void
}): React.JSX.Element {
  // Pages are slug-deduped and renderRow has no index, so identify the last row by its unique slug.
  const lastSlug = artifacts.at(-1)?.artifact.slug
  if (groups) {
    return (
      <>
        {groups.map((group) => (
          <Fragment key={group.id}>
            <h2 className="flex items-center gap-2 bg-muted/50 px-3 py-2 text-xs font-semibold">
              {group.name}
              <span className="text-muted-foreground">({group.artifacts.length})</span>
            </h2>
            <ArtifactListRows
              artifacts={group.artifacts}
              deletingId={deletingId}
              selectedSlug={selectedSlug}
              scrollElement={scrollElement}
              hasMore={hasMore}
              selectArtifact={selectArtifact}
              deleteArtifact={deleteArtifact}
            />
          </Fragment>
        ))}
      </>
    )
  }

  // Transform-positioned inserts do not cause layout shifts that scroll anchoring could correct.
  return (
    <VirtualizedList
      rows={artifacts}
      scrollElement={scrollElement}
      estimateRowHeightPx={ARTIFACTS_TABLE_ROW_HEIGHT_PX}
      announceListPosition
      hasUnloadedRows={hasMore}
      getRowKey={(item) => item.artifact.slug}
      renderRow={(item) => (
        <ArtifactListRow
          key={item.artifact.slug}
          item={item}
          deleting={deletingId === item.artifact.slug}
          isSelected={selectedSlug === item.artifact.slug}
          showDivider={item.artifact.slug !== lastSlug}
          selectArtifact={selectArtifact}
          deleteArtifact={deleteArtifact}
        />
      )}
    />
  )
}
