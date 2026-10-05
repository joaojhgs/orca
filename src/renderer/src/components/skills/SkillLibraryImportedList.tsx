import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { SkillRow } from './SkillRow'
import type {
  SkillLibrarySnapshot,
  SkillLibraryVersion
} from '../../../../shared/skill-library-contract'
import type { DiscoveredSkill } from '../../../../shared/skills'

export function SkillLibraryImportedList(props: {
  snapshot: SkillLibrarySnapshot
  query: string
  busy: boolean
  selecting: boolean
  selected: ReadonlySet<string>
  onSelected(id: string, selected: boolean): void
  onReview(version: SkillLibraryVersion): void
  onAssign(version: SkillLibraryVersion): void
  onShare(version: SkillLibraryVersion): void
  onDelete(version: SkillLibraryVersion): void
}) {
  const [focused, setFocused] = useState<string | null>(null)
  const rows = props.snapshot.versions.filter((version) =>
    `${version.name} ${version.description}`
      .toLowerCase()
      .includes(props.query.trim().toLowerCase())
  )
  const selectedNames = new Set(
    props.snapshot.versions
      .filter((version) => props.selected.has(version.versionId))
      .map((version) => version.name)
  )
  return (
    <div
      role="listbox"
      aria-label={translate('skills.library.importedList', 'Imported skills')}
      aria-multiselectable={props.selecting || undefined}
    >
      {rows.length === 0 ? (
        <p className="py-6 text-xs text-muted-foreground">
          {props.snapshot.versions.length
            ? translate('skills.library.noImportedMatches', 'No imported skills match this search.')
            : translate(
                'skills.library.importedEmpty',
                'No imported skills yet. Choose Import skills to review skills from connected hosts.'
              )}
        </p>
      ) : null}
      {rows.map((version, index) => {
        const skill: DiscoveredSkill = {
          id: version.versionId,
          name: version.name,
          description: version.description,
          providers: [],
          sourceKind: 'home',
          sourceLabel: 'Imported snapshot',
          rootPath: '',
          directoryPath: '',
          skillFilePath: '',
          installed: true,
          updatedAt: Date.parse(version.createdAt)
        }
        const assigned = props.snapshot.assignments.some(
          (row) => row.versionId === version.versionId && row.status !== 'removed'
        )
        return (
          <SkillRow
            key={version.versionId}
            skill={skill}
            selectionMode={props.selecting}
            selected={props.selected.has(version.versionId)}
            selectable={
              !props.busy &&
              (props.selected.has(version.versionId) ||
                (props.selected.size < 50 && !selectedNames.has(version.name)))
            }
            shareable={!props.busy}
            deletable={!props.busy && !assigned}
            deleteDisabledReason={
              assigned
                ? translate(
                    'skills.library.removeAssignmentsFirst',
                    'Unassign this version before deleting it.'
                  )
                : null
            }
            disabledLabel={translate(
              'skills.library.duplicateSelection',
              'Another version selected'
            )}
            disabledReason={
              props.selected.size >= 50
                ? translate(
                    'skills.library.selectionLimit',
                    'Select up to 50 skills per operation.'
                  )
                : translate(
                    'skills.library.oneVersionPerOperation',
                    'Select one version of each skill for this operation.'
                  )
            }
            focusable={
              focused === version.versionId ||
              (!rows.some((row) => row.versionId === focused) && index === 0)
            }
            onFocus={() => setFocused(version.versionId)}
            onOpenDetail={() => !props.busy && props.onReview(version)}
            onSelectionChange={(selected) =>
              !props.busy && props.onSelected(version.versionId, selected)
            }
            onShare={() => props.onShare(version)}
            onDelete={() => props.onDelete(version)}
            libraryActions={{
              onAssign: () => !props.busy && props.onAssign(version),
              versionLabel: version.versionId
            }}
            onKeyDown={(event) => {
              const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
              const next =
                event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : index + delta
              if (delta || event.key === 'Home' || event.key === 'End') {
                event.preventDefault()
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLElement>('[role="option"]')
                  [next]?.focus()
              }
            }}
          />
        )
      })}
    </div>
  )
}
